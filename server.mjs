import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import handler from "serve-handler";

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (kept alive):", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (kept alive):", reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distPath = join(__dirname, "dist");
const port = Number(process.env.PORT || 3000);
const libraryIdPattern = /^[A-Za-z0-9_-]{8,120}$/;
const shareIdPattern = /^[A-Za-z0-9_-]{10,120}$/;
const memoryStore = new Map();
const memorySharedDeckStore = new Map();

let pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
    })
  : null;

let storageKind = pool ? "postgres" : "memory";
let dbInitFailed = false;

const initializeDatabase = async () => {
  if (!pool) {
    return;
  }

  const activePool = pool;

  if (!activePool) {
    return;
  }

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS library_snapshots (
      library_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revision INTEGER NOT NULL DEFAULT 1
    )
  `);

  await activePool.query(`
    ALTER TABLE library_snapshots
    ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1
  `);

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS shared_decks (
      share_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const initDbPromise = initializeDatabase();
const initTimeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("Database connection timed out")), 9000),
);

// Suppress unhandled rejections from whichever promise loses the race
initDbPromise.catch(() => {});
initTimeoutPromise.catch(() => {});

const databaseReady = Promise.race([initDbPromise, initTimeoutPromise]).catch((error) => {
  console.error("Failed to initialize Postgres storage", error);
  pool?.end().catch((endError) => {
    console.error("Failed to close unavailable Postgres pool", endError);
  });
  pool = null;

  const allowMemoryFallback = process.env.ALLOW_MEMORY_STORAGE === "true";

  if (process.env.NODE_ENV === "production" && !allowMemoryFallback) {
    console.error(
      "DATABASE_URL is required in production. Set ALLOW_MEMORY_STORAGE=true to allow in-memory fallback.",
    );
    dbInitFailed = true;
    storageKind = "unavailable";
    return;
  }

  console.warn("Using in-memory storage fallback. Data will be lost on server restart.");
  storageKind = "memory";
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

      if (totalLength > 10 * 1024 * 1024) {
        reject(new Error("Request body exceeded 10 MB."));
        // Drain and abort without destroying the socket so we can still send a response
        request.resume();
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

  if (!pool) {
    return memoryStore.get(libraryId) ?? null;
  }

  const result = await pool.query(
    `
      SELECT data, updated_at, revision
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
    revision: result.rows[0].revision,
  };
};

const saveToMemory = (libraryId, snapshot, expectedRevision) => {
  const existing = memoryStore.get(libraryId);
  const currentRevision = existing?.revision ?? 0;
  if (expectedRevision !== null && currentRevision !== expectedRevision) {
    return { conflict: true, current: existing ?? null };
  }
  const nextRevision = currentRevision + 1;
  const updatedAt = new Date().toISOString();
  const record = { snapshot, updatedAt, revision: nextRevision };
  memoryStore.set(libraryId, record);
  return record;
};

const saveLibrarySnapshot = async (libraryId, snapshot, expectedRevision = null) => {
  if (!pool) {
    return saveToMemory(libraryId, snapshot, expectedRevision);
  }

  await databaseReady;

  if (!pool) {
    return saveToMemory(libraryId, snapshot, expectedRevision);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT data, updated_at, revision FROM library_snapshots WHERE library_id = $1 FOR UPDATE`,
      [libraryId],
    );
    const currentRevision = existing.rowCount ? existing.rows[0].revision : 0;

    if (expectedRevision !== null && currentRevision !== expectedRevision) {
      await client.query("ROLLBACK");
      return {
        conflict: true,
        current: existing.rowCount
          ? {
              snapshot: existing.rows[0].data,
              updatedAt: existing.rows[0].updated_at,
              revision: existing.rows[0].revision,
            }
          : null,
      };
    }

    const nextRevision = currentRevision + 1;
    const result = await client.query(
      `
        INSERT INTO library_snapshots (library_id, data, updated_at, revision)
        VALUES ($1, $2::jsonb, NOW(), $3)
        ON CONFLICT (library_id)
        DO UPDATE SET
          data = EXCLUDED.data,
          updated_at = NOW(),
          revision = EXCLUDED.revision
        RETURNING updated_at, revision
      `,
      [libraryId, JSON.stringify(snapshot), nextRevision],
    );
    await client.query("COMMIT");

    return {
      snapshot,
      updatedAt: result.rows[0].updated_at,
      revision: result.rows[0].revision,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const getSharedDeck = async (shareId) => {
  if (!pool) {
    return memorySharedDeckStore.get(shareId) ?? null;
  }

  await databaseReady;

  if (!pool) {
    return memorySharedDeckStore.get(shareId) ?? null;
  }

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
    const ok = !dbInitFailed;
    return sendJson(response, ok ? 200 : 503, {
      ok,
      storage: storageKind,
    });
  }

  if (dbInitFailed) {
    return sendJson(response, 503, {
      error: "database_unavailable",
      message: "The database is currently unavailable. Please check DATABASE_URL or set ALLOW_MEMORY_STORAGE=true.",
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
        revision: 0,
        storage: storageKind,
      });
    }

    return sendJson(response, 200, {
      exists: true,
      libraryId,
      snapshot: record.snapshot,
      updatedAt: record.updatedAt,
      revision: record.revision,
      storage: storageKind,
    });
  }

  if (request.method === "PUT") {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (readError) {
      const msg = readError instanceof Error ? readError.message : String(readError);
      if (msg.includes("exceeded")) {
        return sendJson(response, 413, {
          error: "payload_too_large",
          message: msg,
        });
      }
      throw readError;
    }

    if (!isLibrarySnapshot(body)) {
      return sendJson(response, 400, {
        error: "invalid_snapshot",
        message: "The uploaded library backup was not in the expected format.",
      });
    }

    const ifMatchHeader = request.headers["if-match"];
    let expectedRevision = null;
    if (typeof ifMatchHeader === "string" && ifMatchHeader.length > 0) {
      const parsed = Number.parseInt(ifMatchHeader.replace(/^"|"$/g, ""), 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return sendJson(response, 400, {
          error: "invalid_if_match",
          message: "If-Match must be a non-negative integer revision.",
        });
      }
      expectedRevision = parsed;
    }

    const record = await saveLibrarySnapshot(libraryId, body, expectedRevision);

    if (record.conflict) {
      return sendJson(response, 409, {
        error: "revision_conflict",
        message:
          "The cloud library changed since you last loaded it. The current cloud version was returned so it can be merged.",
        current: record.current,
        storage: storageKind,
      });
    }

    return sendJson(response, 200, {
      libraryId,
      updatedAt: record.updatedAt,
      revision: record.revision,
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
      const apiPromise = handleApiRequest(request, response, url.pathname);
      apiPromise.catch(() => {});
      const apiTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("API request timed out")), 15000),
      );
      apiTimeout.catch(() => {});
      try {
        await Promise.race([apiPromise, apiTimeout]);
      } catch (apiError) {
        console.error("API request failed or timed out", apiError);
        if (!response.headersSent) {
          sendJson(response, 503, {
            error: "request_timeout",
            message: "The request took too long. Database may be unreachable.",
          });
        }
      }
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
