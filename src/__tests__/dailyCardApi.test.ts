import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pickDailyCard } from "../lib/dailyCard";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4607;
const baseUrl = `http://127.0.0.1:${port}`;
const libraryId = "library-daily";

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

const sections = [
  {
    id: "section-1",
    title: "GPT",
    description: "",
    decks: [
      {
        id: "deck-0",
        title: "Positive Adjectives",
        subtitle: "Starter deck",
        cards: [
          { id: "card-0", term: "term-0", definition: "definition-0" },
          { id: "card-1", term: "term-1", definition: "definition-1" },
        ],
      },
      {
        id: "deck-1",
        title: "emotions1",
        subtitle: "",
        cards: [{ id: "card-2", term: "term-2", definition: "definition-2" }],
      },
    ],
  },
];

const snapshot = {
  version: 1,
  exportedAt: new Date().toISOString(),
  librarySections: sections,
  deckProgress: {
    "deck-0": {
      currentCardId: "card-0",
      knownIds: ["card-0", "card-1"],
      isFlipped: false,
      studyMode: "all",
    },
  },
  selectedDeckId: "deck-0",
};

type DailyCardResponse = {
  exists?: boolean;
  dateKey?: string;
  card?: { id: string; term: string; definition: string } | null;
  deck?: { id: string; title: string; subtitle: string };
  section?: { id: string; title: string };
};

const getDailyCard = async (id: string, query = "") => {
  const response = await fetch(`${baseUrl}/api/libraries/${id}/daily-card${query}`);
  return { status: response.status, payload: (await response.json()) as DailyCardResponse };
};

beforeAll(async () => {
  serverProcess = spawn("node", ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_MEMORY_STORAGE: "true",
      // Readable fixture ids, same reason adminLibraries.test.ts does it.
      ALLOW_CUSTOM_LIBRARY_IDS: "true",
      DATABASE_URL: "",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });

  await waitForServer();

  const response = await fetch(`${baseUrl}/api/libraries/${libraryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  expect(response.status).toBe(200);
}, 30000);

afterAll(() => {
  serverProcess?.kill();
});

describe("GET /api/libraries/:syncKey/daily-card", () => {
  it("serves the card the app itself would pick for that day", async () => {
    const { status, payload } = await getDailyCard(libraryId, "?date=2026-09-10");
    const expected = pickDailyCard(sections, snapshot.deckProgress as never, "2026-09-10");

    expect(status).toBe(200);
    expect(payload.exists).toBe(true);
    expect(payload.dateKey).toBe("2026-09-10");
    expect(payload.card?.id).toBe(expected?.cardId);
    expect(payload.deck?.id).toBe(expected?.deckId);
  });

  it("skips cards already marked known", async () => {
    // Every card in deck-0 is known, so only card-2 is left to study.
    for (const day of ["2026-01-04", "2026-05-19", "2026-09-10", "2026-12-31"]) {
      const { payload } = await getDailyCard(libraryId, `?date=${day}`);
      expect(payload.card?.id).toBe("card-2");
      expect(payload.deck?.title).toBe("emotions1");
    }
  });

  it("is stable for a day and moves across days", async () => {
    const first = await getDailyCard(libraryId, "?date=2026-09-10");
    const again = await getDailyCard(libraryId, "?date=2026-09-10");
    expect(first.payload.card?.id).toBe(again.payload.card?.id);
  });

  it("returns the deck and topic, never the library", async () => {
    const { payload } = await getDailyCard(libraryId, "?date=2026-09-10");
    const body = JSON.stringify(payload);

    expect(payload.deck?.title).toBe("emotions1");
    expect(payload.section?.title).toBe("GPT");
    expect(body).not.toContain("librarySections");
    expect(body).not.toContain("knownIds");
    expect(body).not.toContain("deckProgress");
    // Only the day's card travels — the other three are still in the snapshot.
    expect(body).not.toContain("term-0");
    expect(body).not.toContain("term-1");
  });

  it("falls back to today when no date is given", async () => {
    const { status, payload } = await getDailyCard(libraryId);
    expect(status).toBe(200);
    expect(payload.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.card?.id).toBe("card-2");
  });

  it("rejects a date that is not a real calendar day", async () => {
    for (const bad of ["2026-02-31", "yesterday", "2026-13-01", "26-09-10"]) {
      const { status } = await getDailyCard(libraryId, `?date=${encodeURIComponent(bad)}`);
      expect(status).toBe(400);
    }
  });

  it("reports an unknown library without inventing a card", async () => {
    const { status, payload } = await getDailyCard("library-nothing-here", "?date=2026-09-10");
    expect(status).toBe(200);
    expect(payload.exists).toBe(false);
    expect(payload.card).toBeNull();
  });

  it("rejects a malformed sync key", async () => {
    const { status } = await getDailyCard("short", "?date=2026-09-10");
    expect(status).toBe(400);
  });

  it("does not answer writes", async () => {
    const response = await fetch(`${baseUrl}/api/libraries/${libraryId}/daily-card`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(405);
  });
});
