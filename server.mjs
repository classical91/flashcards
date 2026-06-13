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

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const contentLimits = Object.freeze({
  sections: 50,
  decksPerSection: 100,
  cardsPerDeck: 1000,
  progressEntries: 5000,
  knownIdsPerDeck: 1000,
  recentDeckIds: 100,
  idLength: 120,
  titleLength: 200,
  subtitleLength: 500,
  descriptionLength: 1000,
  termLength: 500,
  definitionLength: 4000,
  timestampLength: 100,
});

const valid = { ok: true };
const invalid = (message) => ({ ok: false, message });

const validateString = (value, path, maxLength) => {
  if (typeof value !== "string") {
    return invalid(`${path} must be a string.`);
  }

  if (value.length > maxLength) {
    return invalid(`${path} must be ${maxLength} characters or fewer.`);
  }

  return valid;
};

const validateStringArray = (value, path, maxItems, maxLength) => {
  if (!Array.isArray(value)) {
    return invalid(`${path} must be an array.`);
  }

  if (value.length > maxItems) {
    return invalid(`${path} cannot contain more than ${maxItems} items.`);
  }

  for (let index = 0; index < value.length; index += 1) {
    const result = validateString(value[index], `${path}[${index}]`, maxLength);
    if (!result.ok) return result;
  }

  return valid;
};

const validateFlashcard = (value, path) => {
  if (!isRecord(value)) {
    return invalid(`${path} must be an object.`);
  }

  const fields = [
    ["id", contentLimits.idLength],
    ["term", contentLimits.termLength],
    ["definition", contentLimits.definitionLength],
  ];

  for (const [field, maxLength] of fields) {
    const result = validateString(value[field], `${path}.${field}`, maxLength);
    if (!result.ok) return result;
  }

  return valid;
};

const validateDeck = (value, path) => {
  if (!isRecord(value)) {
    return invalid(`${path} must be an object.`);
  }

  const fields = [
    ["id", contentLimits.idLength],
    ["title", contentLimits.titleLength],
    ["subtitle", contentLimits.subtitleLength],
  ];

  for (const [field, maxLength] of fields) {
    const result = validateString(value[field], `${path}.${field}`, maxLength);
    if (!result.ok) return result;
  }

  if (!Array.isArray(value.cards)) {
    return invalid(`${path}.cards must be an array.`);
  }

  if (value.cards.length > contentLimits.cardsPerDeck) {
    return invalid(`${path}.cards cannot contain more than ${contentLimits.cardsPerDeck} cards.`);
  }

  for (let index = 0; index < value.cards.length; index += 1) {
    const result = validateFlashcard(value.cards[index], `${path}.cards[${index}]`);
    if (!result.ok) return result;
  }

  return valid;
};

const validateDeckSection = (value, path) => {
  if (!isRecord(value)) {
    return invalid(`${path} must be an object.`);
  }

  const fields = [
    ["id", contentLimits.idLength],
    ["title", contentLimits.titleLength],
    ["description", contentLimits.descriptionLength],
  ];

  for (const [field, maxLength] of fields) {
    const result = validateString(value[field], `${path}.${field}`, maxLength);
    if (!result.ok) return result;
  }

  if (!Array.isArray(value.decks)) {
    return invalid(`${path}.decks must be an array.`);
  }

  if (value.decks.length > contentLimits.decksPerSection) {
    return invalid(
      `${path}.decks cannot contain more than ${contentLimits.decksPerSection} decks.`,
    );
  }

  for (let index = 0; index < value.decks.length; index += 1) {
    const result = validateDeck(value.decks[index], `${path}.decks[${index}]`);
    if (!result.ok) return result;
  }

  return valid;
};

const validateSharedDeckSection = (value, path) => {
  if (!isRecord(value)) {
    return invalid(`${path} must be an object.`);
  }

  const fields = [
    ["id", contentLimits.idLength],
    ["title", contentLimits.titleLength],
    ["description", contentLimits.descriptionLength],
  ];

  for (const [field, maxLength] of fields) {
    const result = validateString(value[field], `${path}.${field}`, maxLength);
    if (!result.ok) return result;
  }

  return valid;
};

const validateDeckProgress = (value, path) => {
  if (!isRecord(value)) {
    return invalid(`${path} must be an object.`);
  }

  const currentCardResult = validateString(
    value.currentCardId,
    `${path}.currentCardId`,
    contentLimits.idLength,
  );
  if (!currentCardResult.ok) return currentCardResult;

  const knownIdsResult = validateStringArray(
    value.knownIds,
    `${path}.knownIds`,
    contentLimits.knownIdsPerDeck,
    contentLimits.idLength,
  );
  if (!knownIdsResult.ok) return knownIdsResult;

  if (typeof value.isFlipped !== "boolean") {
    return invalid(`${path}.isFlipped must be a boolean.`);
  }

  if (value.studyMode !== "all" && value.studyMode !== "remaining") {
    return invalid(`${path}.studyMode must be "all" or "remaining".`);
  }

  return valid;
};

const validateLibrarySnapshot = (value) => {
  if (!isRecord(value)) {
    return invalid("The uploaded library backup must be an object.");
  }

  if (value.version !== 1) {
    return invalid("The uploaded library backup must use snapshot version 1.");
  }

  const exportedAtResult = validateString(
    value.exportedAt,
    "exportedAt",
    contentLimits.timestampLength,
  );
  if (!exportedAtResult.ok) return exportedAtResult;

  if (!Array.isArray(value.librarySections)) {
    return invalid("librarySections must be an array.");
  }

  if (value.librarySections.length > contentLimits.sections) {
    return invalid(`librarySections cannot contain more than ${contentLimits.sections} sections.`);
  }

  for (let index = 0; index < value.librarySections.length; index += 1) {
    const result = validateDeckSection(value.librarySections[index], `librarySections[${index}]`);
    if (!result.ok) return result;
  }

  if (!isRecord(value.deckProgress)) {
    return invalid("deckProgress must be an object.");
  }

  const progressEntries = Object.entries(value.deckProgress);
  if (progressEntries.length > contentLimits.progressEntries) {
    return invalid(`deckProgress cannot contain more than ${contentLimits.progressEntries} decks.`);
  }

  for (const [deckId, progress] of progressEntries) {
    const deckIdResult = validateString(deckId, "deckProgress deck id", contentLimits.idLength);
    if (!deckIdResult.ok) return deckIdResult;
    const result = validateDeckProgress(progress, `deckProgress.${deckId}`);
    if (!result.ok) return result;
  }

  const selectedDeckResult = validateString(
    value.selectedDeckId,
    "selectedDeckId",
    contentLimits.idLength,
  );
  if (!selectedDeckResult.ok) return selectedDeckResult;

  if ("recentDeckIds" in value) {
    const recentDeckIdsResult = validateStringArray(
      value.recentDeckIds,
      "recentDeckIds",
      contentLimits.recentDeckIds,
      contentLimits.idLength,
    );
    if (!recentDeckIdsResult.ok) return recentDeckIdsResult;
  }

  return valid;
};

const validateSharedDeckRequest = (value) => {
  if (!isRecord(value)) {
    return invalid("The shared deck request must be an object.");
  }

  const deckResult = validateDeck(value.deck, "deck");
  if (!deckResult.ok) return deckResult;

  return validateSharedDeckSection(value.section, "section");
};

const validateSharedDeckSnapshot = (value) => {
  if (!isRecord(value)) {
    return invalid("The shared deck snapshot must be an object.");
  }

  if (value.version !== 1) {
    return invalid("The shared deck snapshot must use version 1.");
  }

  const sharedAtResult = validateString(value.sharedAt, "sharedAt", contentLimits.timestampLength);
  if (!sharedAtResult.ok) return sharedAtResult;

  const deckResult = validateDeck(value.deck, "deck");
  if (!deckResult.ok) return deckResult;

  return validateSharedDeckSection(value.section, "section");
};

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
      message:
        "The database is currently unavailable. Please check DATABASE_URL or set ALLOW_MEMORY_STORAGE=true.",
    });
  }

  if (pathname === "/api/shared-decks" && request.method === "POST") {
    const body = await readJsonBody(request);
    const validation = validateSharedDeckRequest(body);

    if (!validation.ok) {
      return sendJson(response, 400, {
        error: "invalid_shared_deck",
        message: validation.message,
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

    if (!record || !validateSharedDeckSnapshot(record.snapshot).ok) {
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

    const validation = validateLibrarySnapshot(body);

    if (!validation.ok) {
      return sendJson(response, 400, {
        error: "invalid_snapshot",
        message: validation.message,
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
