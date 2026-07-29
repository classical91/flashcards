import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4599;
const baseUrl = `http://127.0.0.1:${port}`;
const adminToken = "test-admin-token";

let serverProcess: ChildProcess;

const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready in time.");
};

const putLibrary = async (libraryId: string, decks: { title: string; cardCount: number }[]) => {
  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    librarySections: [
      {
        id: "section-1",
        title: "GPT",
        description: "",
        decks: decks.map((deck, deckIndex) => ({
          id: `deck-${deckIndex}`,
          title: deck.title,
          subtitle: "",
          cards: Array.from({ length: deck.cardCount }, (_, cardIndex) => ({
            id: `card-${deckIndex}-${cardIndex}`,
            term: `term-${cardIndex}`,
            definition: `definition-${cardIndex}`,
          })),
        })),
      },
    ],
    deckProgress: {},
    selectedDeckId: "deck-0",
  };

  const response = await fetch(`${baseUrl}/api/libraries/${libraryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });

  expect(response.status).toBe(200);
};

beforeAll(async () => {
  serverProcess = spawn("node", ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_TOKEN: adminToken,
      ALLOW_MEMORY_STORAGE: "true",
      DATABASE_URL: "",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });

  await waitForServer();
  await putLibrary("library-alpha", [
    { title: "Positive Adjectives", cardCount: 3 },
    { title: "emotions1", cardCount: 2 },
  ]);
  await putLibrary("library-beta", [{ title: "Solo deck", cardCount: 1 }]);
}, 30000);

afterAll(() => {
  serverProcess?.kill();
});

describe("GET /api/admin/libraries", () => {
  it("reports a signed-out browser session without logging a failed request", async () => {
    const response = await fetch(`${baseUrl}/api/admin/session`);
    const payload = (await response.json()) as { authenticated: boolean };

    expect(response.status).toBe(200);
    expect(payload.authenticated).toBe(false);
  });

  it("rejects requests without a token", async () => {
    const response = await fetch(`${baseUrl}/api/admin/libraries`);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects requests with the wrong token", async () => {
    const response = await fetch(`${baseUrl}/api/admin/libraries`, {
      headers: { Authorization: "Bearer wrong-token" },
    });

    expect(response.status).toBe(401);
  });

  it("lists sync keys with deck and card counts", async () => {
    const response = await fetch(`${baseUrl}/api/admin/libraries`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      count: number;
      limit: number;
      libraries: {
        libraryId: string;
        revision: number;
        sectionCount: number;
        deckCount: number;
        cardCount: number;
        decks: { deckTitle: string; cardCount: number }[];
      }[];
    };

    expect(payload.count).toBe(2);
    expect(payload.limit).toBe(100);

    const alpha = payload.libraries.find((entry) => entry.libraryId === "library-alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.sectionCount).toBe(1);
    expect(alpha?.deckCount).toBe(2);
    expect(alpha?.cardCount).toBe(5);
    expect(alpha?.revision).toBe(1);
    expect(alpha?.decks.map((deck) => deck.deckTitle)).toEqual([
      "Positive Adjectives",
      "emotions1",
    ]);
  });

  it("never returns card terms or definitions", async () => {
    const response = await fetch(`${baseUrl}/api/admin/libraries`, {
      headers: { "x-admin-token": adminToken },
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("term-0");
    expect(body).not.toContain("definition-0");
  });

  it("honours the limit parameter and rejects invalid limits", async () => {
    const limited = await fetch(`${baseUrl}/api/admin/libraries?limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const limitedPayload = (await limited.json()) as { count: number };

    expect(limited.status).toBe(200);
    expect(limitedPayload.count).toBe(1);

    const invalid = await fetch(`${baseUrl}/api/admin/libraries?limit=0`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(invalid.status).toBe(400);
  });

  it("rejects non-GET methods", async () => {
    const response = await fetch(`${baseUrl}/api/admin/libraries`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(response.status).toBe(405);
  });

  it("creates an HttpOnly browser session for the administration account", async () => {
    const login = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({
        username: "admin",
        password: adminToken,
      }),
    });

    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("flashcards_admin_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const sessionCookie = cookie?.split(";")[0] ?? "";
    const listing = await fetch(`${baseUrl}/api/admin/libraries`, {
      headers: { Cookie: sessionCookie },
    });
    expect(listing.status).toBe(200);
  });

  it("rejects an incorrect administration account password", async () => {
    const response = await fetch(`${baseUrl}/api/admin/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
      },
      body: JSON.stringify({
        username: "admin",
        password: "wrong-password",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("deletes only the explicitly confirmed cloud library", async () => {
    await putLibrary("library-delete-me", [{ title: "Temporary", cardCount: 1 }]);

    const missingConfirmation = await fetch(
      `${baseUrl}/api/admin/libraries/library-delete-me`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Origin: baseUrl,
        },
      },
    );
    expect(missingConfirmation.status).toBe(400);

    const deleted = await fetch(`${baseUrl}/api/admin/libraries/library-delete-me`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        Origin: baseUrl,
        "X-Confirm-Library-Id": "library-delete-me",
      },
    });
    expect(deleted.status).toBe(200);

    const lookup = await fetch(`${baseUrl}/api/libraries/library-delete-me`);
    const lookupPayload = (await lookup.json()) as { exists: boolean };
    expect(lookupPayload.exists).toBe(false);
  });
});

describe("GET /api/admin/libraries without ADMIN_TOKEN", () => {
  const disabledPort = 4600;
  const disabledBaseUrl = `http://127.0.0.1:${disabledPort}`;
  let disabledServer: ChildProcess;

  beforeAll(async () => {
    disabledServer = spawn("node", ["server.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(disabledPort),
        ADMIN_TOKEN: "",
        ALLOW_MEMORY_STORAGE: "true",
        DATABASE_URL: "",
        NODE_ENV: "test",
      },
      stdio: "ignore",
    });

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`${disabledBaseUrl}/api/health`);
        if (response.ok) return;
      } catch {
        // Server not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error("Server did not become ready in time.");
  }, 30000);

  afterAll(() => {
    disabledServer?.kill();
  });

  it("hides the route entirely", async () => {
    const response = await fetch(`${disabledBaseUrl}/api/admin/libraries`);

    expect(response.status).toBe(404);
  });
});
