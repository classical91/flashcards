import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4601;
const baseUrl = `http://127.0.0.1:${port}`;

let serverProcess: ChildProcess;

const buildSnapshot = (decks: { title: string; cardCount: number }[], knownCount = 0) => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  librarySections: [
    {
      id: "personal",
      title: "Personal",
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
  deckProgress: {
    "deck-0": {
      currentCardId: "card-0-0",
      knownIds: Array.from({ length: knownCount }, (_, index) => `card-0-${index}`),
      isFlipped: false,
      studyMode: "all",
    },
  },
  selectedDeckId: "deck-0",
});

const put = async (libraryId: string, snapshot: unknown) => {
  const response = await fetch(`${baseUrl}/api/libraries/${libraryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });

  return { status: response.status, body: (await response.json()) as { message?: string } };
};

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
}, 30000);

afterAll(() => {
  serverProcess?.kill();
});

describe("library snapshot size limits", () => {
  it("accepts a deck larger than the old 1000-card cap", async () => {
    const result = await put(
      "real-library-key",
      buildSnapshot([{ title: "Words", cardCount: 1617 }]),
    );

    expect(result.status).toBe(200);
  });

  it("accepts every card in a large deck being marked known", async () => {
    const result = await put(
      "all-known-key",
      buildSnapshot([{ title: "Words", cardCount: 1617 }], 1617),
    );

    expect(result.status).toBe(200);
  });

  it("still rejects a deck beyond the current cap, naming the deck", async () => {
    const result = await put(
      "oversized-key",
      buildSnapshot([{ title: "Runaway", cardCount: 5001 }]),
    );

    expect(result.status).toBe(400);
    expect(result.body.message).toContain('"Runaway"');
    expect(result.body.message).toContain("5001");
  });

  it("names the section when it holds too many decks", async () => {
    const decks = Array.from({ length: 251 }, (_, index) => ({
      title: `Deck ${index}`,
      cardCount: 1,
    }));
    const result = await put("too-many-decks-key", buildSnapshot(decks));

    expect(result.status).toBe(400);
    expect(result.body.message).toContain('"Personal"');
    expect(result.body.message).toContain("251");
  });
});
