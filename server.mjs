import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import handler from "serve-handler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, "dist");
const port = Number(process.env.PORT || 3000);
const libraryIdPattern = /^[A-Za-z0-9_-]{8,120}$/;
const shareIdPattern = /^[A-Za-z0-9_-]{10,120}$/;
const memoryStore = new Map();
const memorySharedDeckStore = new Map();

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
    })
  : null;

const storageKind = pool ? "postgres" : "memory";

const initializeDatabase = async () => {
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS library_snapshots (
      library_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_decks (
      share_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const databaseReady = initializeDatabase();

databaseReady.catch((error) => {
  console.error("Failed to initialize storage", error);
  process.exit(1);
});

const sendJson = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFlashcard = (value) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.term === "string" &&
  typeof value.definition === "string";

const isDeck = (value) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  Array.isArray(value.cards) &&
  value.cards.every(isFlashcard);

const isDeckSection = (value) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.description === "string" &&
  Array.isArray(value.decks) &&
  value.decks.every(isDeck);

const isSharedDeckSection = (value) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.description === "string";

const isDeckProgress = (value) =>
  isRecord(value) &&
  typeof value.currentCardId === "string" &&
  Array.isArray(value.knownIds) &&
  value.knownIds.every((item) => typeof item === "string") &&
  typeof value.isFlipped === "boolean" &&
  (value.studyMode === "all" || value.studyMode === "remaining");

const isLibrarySnapshot = (value) => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.exportedAt !== "string" ||
    !Array.isArray(value.librarySections) ||
    !value.librarySections.every(isDeckSection) ||
    !isRecord(value.deckProgress) ||
    typeof value.selectedDeckId !== "string"
  ) {
    return false;
  }

  if (!Object.values(value.deckProgress).every(isDeckProgress)) {
    return false;
  }

  if (
    "recentDeckIds" in value &&
    (!Array.isArray(value.recentDeckIds) ||
      !value.recentDeckIds.every((item) => typeof item === "string"))
  ) {
    return false;
  }

  return true;
};

const isSharedDeckRequest = (value) =>
  isRecord(value) && isDeck(value.deck) && isSharedDeckSection(value.section);

const isSharedDeckSnapshot = (value) =>
  isRecord(value) &&
  value.version === 1 &&
  typeof value.sharedAt === "string" &&
  isDeck(value.deck) &&
  isSharedDeckSection(value.section);

const readJsonBody = async (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    request.on("data", (chunk) => {
      totalLength += chunk.length;

      if (totalLength > 1024 * 1024) {
        reject(new Error("Request body exceeded 1 MB."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });

const createShareId = () => randomBytes(18).toString("base64url");

const getLibrarySnapshot = async (libraryId) => {
  if (!pool) {
    return memoryStore.get(libraryId) ?? null;
  }

  await databaseReady;

  const result = await pool.query(
    `
      SELECT data, updated_at
      FROM library_snapshots
      WHERE library_id = $1
    `,
    [libraryId],
  );

  if (!result.rowCount) {
    return null;
  }

  return {
    snapshot: result.rows[0].data,
    updatedAt: result.rows[0].updated_at,
  };
};

const saveLibrarySnapshot = async (libraryId, snapshot) => {
  if (!pool) {
    const updatedAt = new Date().toISOString();

    memoryStore.set(libraryId, {
      snapshot,
      updatedAt,
    });

    return {
      snapshot,
      updatedAt,
    };
  }

  await databaseReady;

  const result = await pool.query(
    `
      INSERT INTO library_snapshots (library_id, data, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (library_id)
      DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = NOW()
      RETURNING updated_at
    `,
    [libraryId, JSON.stringify(snapshot)],
  );

  return {
    snapshot,
    updatedAt: result.rows[0].updated_at,
  };
};

const getSharedDeck = async (shareId) => {
  if (!pool) {
    return memorySharedDeckStore.get(shareId) ?? null;
  }

  await databaseReady;

  const result = await pool.query(
    `
      SELECT data, updated_at
      FROM shared_decks
      WHERE share_id = $1
    `,
    [shareId],
  );

  if (!result.rowCount) {
    return null;
  }

  return {
    snapshot: result.rows[0].data,
    updatedAt: result.rows[0].updated_at,
  };
};

const saveSharedDeck = async (shareId, snapshot) => {
  if (!pool) {
    const updatedAt = new Date().toISOString();

    memorySharedDeckStore.set(shareId, {
      snapshot,
      updatedAt,
    });

    return {
      snapshot,
      updatedAt,
    };
  }

  await databaseReady;

  const result = await pool.query(
    `
      INSERT INTO shared_decks (share_id, data, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      RETURNING updated_at
    `,
    [shareId, JSON.stringify(snapshot)],
  );

  return {
    snapshot,
    updatedAt: result.rows[0].updated_at,
  };
};

const handleApiRequest = async (request, response, pathname) => {
  if (pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, {
      ok: true,
      storage: storageKind,
    });
  }

  if (pathname === "/api/shared-decks" && request.method === "POST") {
    const body = await readJsonBody(request);

    if (!isSharedDeckRequest(body)) {
      return sendJson(response, 400, {
        error: "invalid_shared_deck",
        message: "That deck could not be turned into a share link.",
      });
    }

    const shareId = createShareId();
    const snapshot = {
      version: 1,
      sharedAt: new Date().toISOString(),
      deck: body.deck,
      section: body.section,
    };
    const record = await saveSharedDeck(shareId, snapshot);

    return sendJson(response, 200, {
      shareId,
      snapshot: record.snapshot,
      updatedAt: record.updatedAt,
      storage: storageKind,
    });
  }

  const sharedDeckMatch = pathname.match(/^\/api\/shared-decks\/([A-Za-z0-9_-]{1,200})$/);

  if (sharedDeckMatch) {
    const shareId = sharedDeckMatch[1];

    if (!shareIdPattern.test(shareId)) {
      return sendJson(response, 400, {
        error: "invalid_share_id",
        message:
          "Share IDs must be 10-120 characters long and use only letters, numbers, hyphens, or underscores.",
      });
    }

    if (request.method !== "GET") {
      return sendJson(response, 405, {
        error: "method_not_allowed",
        message: "Only GET is supported for shared deck links.",
      });
    }

    const record = await getSharedDeck(shareId);

    if (!record || !isSharedDeckSnapshot(record.snapshot)) {
      return sendJson(response, 404, {
        error: "shared_deck_not_found",
        message: "That shared deck link could not be found.",
      });
    }

    return sendJson(response, 200, {
      exists: true,
      shareId,
      snapshot: record.snapshot,
      updatedAt: record.updatedAt,
      storage: storageKind,
    });
  }

  const libraryMatch = pathname.match(/^\/api\/libraries\/([A-Za-z0-9_-]{1,200})$/);

  if (!libraryMatch) {
    return sendJson(response, 404, {
      error: "not_found",
      message: "That API route does not exist.",
    });
  }

  const libraryId = libraryMatch[1];

  if (!libraryIdPattern.test(libraryId)) {
    return sendJson(response, 400, {
      error: "invalid_library_id",
      message:
        "Library IDs must be 8-120 characters long and use only letters, numbers, hyphens, or underscores.",
    });
  }

  if (request.method === "GET") {
    const record = await getLibrarySnapshot(libraryId);

    if (!record) {
      return sendJson(response, 200, {
        exists: false,
        snapshot: null,
        storage: storageKind,
      });
    }

    return sendJson(response, 200, {
      exists: true,
      libraryId,
      snapshot: record.snapshot,
      updatedAt: record.updatedAt,
      storage: storageKind,
    });
  }

  if (request.method === "PUT") {
    const body = await readJsonBody(request);

    if (!isLibrarySnapshot(body)) {
      return sendJson(response, 400, {
        error: "invalid_snapshot",
        message: "The uploaded library backup was not in the expected format.",
      });
    }

    const record = await saveLibrarySnapshot(libraryId, body);

    return sendJson(response, 200, {
      libraryId,
      updatedAt: record.updatedAt,
      storage: storageKind,
    });
  }

  return sendJson(response, 405, {
    error: "method_not_allowed",
    message: "Only GET and PUT are supported for library sync.",
  });
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(request, response, url.pathname);
      return;
    }

    await handler(request, response, {
      public: distPath,
      cleanUrls: true,
      rewrites: [
        {
          source: "**",
          destination: "/index.html",
        },
      ],
    });
  } catch (error) {
    console.error("Request failed", error);
    sendJson(response, 500, {
      error: "internal_error",
      message: "Something went wrong while handling this request.",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving ${distPath} with ${storageKind} storage on port ${port}`);
});
