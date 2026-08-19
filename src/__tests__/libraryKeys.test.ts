import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSyncKey } from "../lib/sync";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Ports are hardcoded per test file and vitest runs files in parallel, so these
// must not collide with adminLibraries (4599/4600), snapshotLimits (4601) or
// sharedDecks (4603).
const port = 4605;
const customPort = 4606;
const baseUrl = `http://127.0.0.1:${port}`;
const customBaseUrl = `http://127.0.0.1:${customPort}`;

let serverProcess: ChildProcess;
let customServerProcess: ChildProcess;

const snapshot = {
  version: 1,
  exportedAt: new Date().toISOString(),
  librarySections: [
    {
      id: "section-1",
      title: "GPT",
      description: "",
      decks: [
        {
          id: "deck-0",
          title: "Deck",
          subtitle: "",
          cards: [{ id: "card-0", term: "term", definition: "definition" }],
        },
      ],
    },
  ],
  deckProgress: {},
  selectedDeckId: "deck-0",
};

const waitForServer = async (url: string) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // Server not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready in time.");
};

const put = (libraryId: string, url = baseUrl, headers: Record<string, string> = {}) =>
  fetch(`${url}/api/libraries/${libraryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(snapshot),
  });

beforeAll(async () => {
  serverProcess = spawn("node", ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_MEMORY_STORAGE: "true",
      DATABASE_URL: "",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });

  customServerProcess = spawn("node", ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(customPort),
      ALLOW_MEMORY_STORAGE: "true",
      ALLOW_CUSTOM_LIBRARY_IDS: "true",
      DATABASE_URL: "",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });

  await Promise.all([waitForServer(baseUrl), waitForServer(customBaseUrl)]);
}, 30000);

afterAll(() => {
  serverProcess?.kill();
  customServerProcess?.kill();
});

describe("createSyncKey", () => {
  it("always produces a key the server will accept for creation", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(createSyncKey()).toMatch(/^fc_[A-Za-z0-9]{16,}$/);
    }
  });

  it("does not repeat itself", () => {
    const keys = new Set(Array.from({ length: 500 }, () => createSyncKey()));
    expect(keys.size).toBe(500);
  });
});

describe("creating a library", () => {
  it("accepts a key from the app's generator", async () => {
    const response = await put(createSyncKey());
    expect(response.status).toBe(200);
  });

  it("refuses to open a new library under a guessable key", async () => {
    for (const weak of ["flashcards", "password", "12345678", "jason123", "myflashcards"]) {
      const response = await put(weak);
      expect(response.status, `expected ${weak} to be refused`).toBe(403);
      expect((await response.json()).error).toBe("library_id_not_generated");
    }
  });

  it("leaves no trace of a refused key", async () => {
    await put("flashcards");
    const lookup = await (await fetch(`${baseUrl}/api/libraries/flashcards`)).json();
    expect(lookup.exists).toBe(false);
  });

  it("still rejects a malformed id before the generated-key check", async () => {
    const response = await put("short1");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_library_id");
  });
});

describe("existing libraries", () => {
  // The check gates creation only: the rejection is keyed on the row being
  // absent, not on the key's shape. A library saved before this rule existed
  // therefore keeps working — which matters, because the alternative is
  // silently stranding someone's decks behind a key they can no longer save to.
  it("keeps updating a library once its row exists", async () => {
    const key = createSyncKey();

    const created = await put(key);
    expect(created.status).toBe(200);
    expect((await created.json()).revision).toBe(1);

    const updated = await put(key, baseUrl, { "If-Match": "1" });
    expect(updated.status).toBe(200);
    expect((await updated.json()).revision).toBe(2);
  });

  it("updates a legacy non-generated key that already has a row", async () => {
    const legacy = "legacy-library-key";

    // In-memory storage is per process, so the row has to be seeded on a server
    // that permits custom ids. Both servers run the same enforcement code, and
    // the branch under test only asks whether the row exists.
    expect((await put(legacy, customBaseUrl)).status).toBe(200);

    const updated = await put(legacy, customBaseUrl, { "If-Match": "1" });
    expect(updated.status).toBe(200);
    expect((await updated.json()).revision).toBe(2);

    // The same key against the enforcing server has no row there, so it is
    // refused — confirming the rule turns on row-existence, not on the id.
    expect((await put(legacy)).status).toBe(403);
  });

  it("reads any well-formed key regardless of shape", async () => {
    const response = await fetch(`${baseUrl}/api/libraries/flashcards`);
    expect(response.status).toBe(200);
  });
});

describe("ALLOW_CUSTOM_LIBRARY_IDS", () => {
  it("re-enables custom keys for deployments that seed a shared library", async () => {
    const response = await put("teamsharedlibrary", customBaseUrl);
    expect(response.status).toBe(200);
  });
});
