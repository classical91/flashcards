import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
const adminToken = process.env.ADMIN_TOKEN?.trim() || "";
const adminUsername = process.env.ADMIN_USERNAME?.trim() || "admin";
const adminSessionCookie = "flashcards_admin_session";
const adminSessionLifetimeSeconds = 8 * 60 * 60;
const adminListLimits = Object.freeze({ default: 100, max: 500 });

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
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
};

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const constantTimeStringEqual = (expected, presented) => {
  if (typeof expected !== "string" || typeof presented !== "string") {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const presentedBuffer = Buffer.from(presented, "utf8");

  if (expectedBuffer.length !== presentedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, presentedBuffer);
};

// Ceilings are abuse guards, not editorial limits: real libraries have decks
// well past a thousand cards, and rejecting one deck rejects the whole
// snapshot, so a too-tight cap silently strands every device on that key.
// The 10 MB body cap in readJsonBody() remains the real backstop.
const contentLimits = Object.freeze({
  sections: 50,
  decksPerSection: 250,
  cardsPerDeck: 5000,
  progressEntries: 5000,
  // Every card in a deck can be marked known, so this must track cardsPerDeck.
  knownIdsPerDeck: 5000,
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
    // Name the deck: an index path alone leaves no way to find the offender in
    // a library with hundreds of decks.
    const deckLabel = typeof value.title === "string" && value.title ? ` ("${value.title}")` : "";
    return invalid(
      `${path}${deckLabel}.cards has ${value.cards.length} cards, more than the ${contentLimits.cardsPerDeck} allowed per deck.`,
    );
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
    const sectionLabel =
      typeof value.title === "string" && value.title ? ` ("${value.title}")` : "";
    return invalid(
      `${path}${sectionLabel}.decks has ${value.decks.length} decks, more than the ${contentLimits.decksPerSection} allowed per section.`,
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

const parseCookies = (request) => {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") return {};

  return Object.fromEntries(
    cookieHeader.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      return [[name, value]];
    }),
  );
};

const signAdminSession = (payload) =>
  createHmac("sha256", adminToken).update(payload).digest("base64url");

const createAdminSession = () => {
  const payload = Buffer.from(
    JSON.stringify({
      username: adminUsername,
      expiresAt: Date.now() + adminSessionLifetimeSeconds * 1000,
    }),
    "utf8",
  ).toString("base64url");

  return `${payload}.${signAdminSession(payload)}`;
};

const verifyAdminSession = (session) => {
  if (!adminToken || typeof session !== "string") return false;

  const separator = session.lastIndexOf(".");
  if (separator < 1) return false;

  const payload = session.slice(0, separator);
  const signature = session.slice(separator + 1);
  if (!constantTimeStringEqual(signAdminSession(payload), signature)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return (
      decoded?.username === adminUsername &&
      Number.isFinite(decoded?.expiresAt) &&
      decoded.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
};

const isSecureRequest = (request) =>
  process.env.NODE_ENV === "production" ||
  String(request.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim() === "https";

const adminCookieHeader = (request, value, maxAge) =>
  [
    `${adminSessionCookie}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/admin",
    `Max-Age=${maxAge}`,
    isSecureRequest(request) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

/**
 * Supports the existing bearer token for scripts and an HttpOnly signed session
 * for the browser dashboard. Returns false whenever ADMIN_TOKEN is unset.
 */
const isAdminRequestAuthorized = (request) => {
  if (!adminToken) return false;

  const header = request.headers.authorization;
  const presented =
    typeof header === "string" && /^Bearer /i.test(header)
      ? header.slice(7).trim()
      : typeof request.headers["x-admin-token"] === "string"
        ? request.headers["x-admin-token"].trim()
        : "";

  if (presented && constantTimeStringEqual(adminToken, presented)) {
    return true;
  }

  return verifyAdminSession(parseCookies(request)[adminSessionCookie]);
};

const isSameOriginRequest = (request) => {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    return originUrl.host === request.headers.host;
  } catch {
    return false;
  }
};

/**
 * Reduces a snapshot to counts and deck titles only — never card terms or
 * definitions, so the admin listing stays a directory rather than a data dump.
 */
const summarizeSnapshot = (snapshot) => {
  const sections = Array.isArray(snapshot?.librarySections) ? snapshot.librarySections : [];
  const decks = [];
  let cardCount = 0;

  for (const section of sections) {
    const sectionDecks = Array.isArray(section?.decks) ? section.decks : [];

    for (const deck of sectionDecks) {
      const deckCardCount = Array.isArray(deck?.cards) ? deck.cards.length : 0;
      cardCount += deckCardCount;
      decks.push({
        sectionTitle: typeof section?.title === "string" ? section.title : "",
        deckId: typeof deck?.id === "string" ? deck.id : "",
        deckTitle: typeof deck?.title === "string" ? deck.title : "",
        cardCount: deckCardCount,
      });
    }
  }

  return {
    sectionCount: sections.length,
    deckCount: decks.length,
    cardCount,
    decks,
  };
};

const listLibrarySummaries = async (limit) => {
  if (!pool) {
    return [...memoryStore.entries()]
      .sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)))
      .slice(0, limit)
      .map(([libraryId, record]) => ({
        libraryId,
        updatedAt: record.updatedAt,
        revision: record.revision,
        ...summarizeSnapshot(record.snapshot),
      }));
  }

  await databaseReady;

  if (!pool) {
    return listLibrarySummaries(limit);
  }

  const result = await pool.query(
    `
      SELECT library_id, data, updated_at, revision
      FROM library_snapshots
      ORDER BY updated_at DESC
      LIMIT $1
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    libraryId: row.library_id,
    updatedAt: row.updated_at,
    revision: row.revision,
    ...summarizeSnapshot(row.data),
  }));
};

const deleteLibrarySnapshot = async (libraryId) => {
  if (!pool) {
    return memoryStore.delete(libraryId);
  }

  await databaseReady;

  if (!pool) {
    return memoryStore.delete(libraryId);
  }

  const result = await pool.query(
    `
      DELETE FROM library_snapshots
      WHERE library_id = $1
      RETURNING library_id
    `,
    [libraryId],
  );

  return result.rowCount > 0;
};

const handleApiRequest = async (
  request,
  response,
  pathname,
  searchParams = new URLSearchParams(),
) => {
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

  if (pathname === "/api/admin/session") {
    if (!adminToken) {
      return sendJson(response, 404, {
        error: "not_found",
        message: "That API route does not exist.",
      });
    }

    if (request.method === "POST") {
      if (!isSameOriginRequest(request)) {
        return sendJson(response, 403, {
          error: "invalid_origin",
          message: "The admin login must come from this site.",
        });
      }

      let credentials;
      try {
        credentials = await readJsonBody(request);
      } catch {
        return sendJson(response, 400, {
          error: "invalid_credentials",
          message: "Enter a valid username and password.",
        });
      }

      const validUsername = constantTimeStringEqual(
        adminUsername,
        typeof credentials?.username === "string" ? credentials.username.trim() : "",
      );
      const validPassword = constantTimeStringEqual(
        adminToken,
        typeof credentials?.password === "string" ? credentials.password : "",
      );

      if (!validUsername || !validPassword) {
        return sendJson(response, 401, {
          error: "invalid_credentials",
          message: "The username or password is incorrect.",
        });
      }

      response.setHeader(
        "Set-Cookie",
        adminCookieHeader(request, createAdminSession(), adminSessionLifetimeSeconds),
      );
      return sendJson(response, 200, {
        authenticated: true,
        username: adminUsername,
      });
    }

    if (request.method === "DELETE") {
      if (!isSameOriginRequest(request)) {
        return sendJson(response, 403, {
          error: "invalid_origin",
          message: "The admin sign-out must come from this site.",
        });
      }

      response.setHeader("Set-Cookie", adminCookieHeader(request, "", 0));
      return sendJson(response, 200, { authenticated: false });
    }

    if (request.method === "GET") {
      if (!isAdminRequestAuthorized(request)) {
        return sendJson(response, 200, {
          authenticated: false,
        });
      }

      return sendJson(response, 200, {
        authenticated: true,
        username: adminUsername,
      });
    }

    return sendJson(response, 405, {
      error: "method_not_allowed",
      message: "Only GET, POST, and DELETE are supported for admin sessions.",
    });
  }

  if (pathname === "/api/admin/libraries") {
    if (!adminToken) {
      return sendJson(response, 404, {
        error: "not_found",
        message: "That API route does not exist.",
      });
    }

    if (!isAdminRequestAuthorized(request)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="flashcards-admin"');
      return sendJson(response, 401, {
        error: "unauthorized",
        message: "Send the admin token as an Authorization: Bearer header.",
      });
    }

    if (request.method !== "GET") {
      return sendJson(response, 405, {
        error: "method_not_allowed",
        message: "Only GET is supported for the admin library listing.",
      });
    }

    const rawLimit = searchParams.get("limit");
    let limit = adminListLimits.default;

    if (rawLimit !== null) {
      const parsed = Number.parseInt(rawLimit, 10);

      if (!Number.isFinite(parsed) || parsed < 1 || parsed > adminListLimits.max) {
        return sendJson(response, 400, {
          error: "invalid_limit",
          message: `limit must be an integer between 1 and ${adminListLimits.max}.`,
        });
      }

      limit = parsed;
    }

    const libraries = await listLibrarySummaries(limit);

    return sendJson(response, 200, {
      count: libraries.length,
      limit,
      storage: storageKind,
      libraries,
    });
  }

  const adminLibraryMatch = pathname.match(
    /^\/api\/admin\/libraries\/([A-Za-z0-9_-]{1,200})$/,
  );

  if (adminLibraryMatch) {
    if (!adminToken) {
      return sendJson(response, 404, {
        error: "not_found",
        message: "That API route does not exist.",
      });
    }

    if (!isAdminRequestAuthorized(request)) {
      return sendJson(response, 401, {
        error: "unauthorized",
        message: "Sign in to the administration account.",
      });
    }

    if (request.method !== "DELETE") {
      return sendJson(response, 405, {
        error: "method_not_allowed",
        message: "Only DELETE is supported for an individual admin library record.",
      });
    }

    if (!isSameOriginRequest(request)) {
      return sendJson(response, 403, {
        error: "invalid_origin",
        message: "Library deletion must come from this site.",
      });
    }

    const libraryId = adminLibraryMatch[1];
    if (!libraryIdPattern.test(libraryId)) {
      return sendJson(response, 400, {
        error: "invalid_library_id",
        message:
          "Library IDs must be 8-120 characters long and use only letters, numbers, hyphens, or underscores.",
      });
    }

    if (request.headers["x-confirm-library-id"] !== libraryId) {
      return sendJson(response, 400, {
        error: "confirmation_required",
        message: "Confirm the exact library ID before deleting it.",
      });
    }

    const deleted = await deleteLibrarySnapshot(libraryId);
    if (!deleted) {
      return sendJson(response, 404, {
        error: "library_not_found",
        message: "That cloud library no longer exists.",
      });
    }

    return sendJson(response, 200, {
      deleted: true,
      libraryId,
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
      const apiPromise = handleApiRequest(request, response, url.pathname, url.searchParams);
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
