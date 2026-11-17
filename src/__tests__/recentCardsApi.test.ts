import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseRecentLimit, resolveRecentCards } from "../../server-recent-cards.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4611;
const baseUrl = `http://127.0.0.1:${port}`;
const libraryId = "library-recent";

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
    title: "Oxford Dictionaries",
    description: "",
    decks: [
      {
        id: "deck-danger",
        title: "Danger",
        subtitle: "",
        cards: [
          { id: "card-0", term: "peril", definition: "serious danger" },
          { id: "card-1", term: "hazard", definition: "a source of danger" },
        ],
      },
      { id: "deck-empty", title: "Empty", subtitle: "", cards: [] },
    ],
  },
  {
    id: "section-2",
    title: "GPT",
    description: "",
    decks: [
      {
        id: "deck-love",
        title: "Love",
        subtitle: "",
        cards: [{ id: "card-2", term: "adore", definition: "love deeply" }],
      },
    ],
  },
];

const viewedDanger = Date.UTC(2026, 10, 14, 12, 0, 0);
const viewedLove = Date.UTC(2026, 10, 13, 12, 0, 0);

const snapshot = {
  version: 2,
  exportedAt: new Date().toISOString(),
  librarySections: sections,
  deckProgress: {
    "deck-danger": { currentCardId: "card-1", knownIds: [], isFlipped: false, studyMode: "all" },
    // Points at a card that has since been deleted.
    "deck-love": { currentCardId: "gone", knownIds: [], isFlipped: false, studyMode: "all" },
  },
  selectedDeckId: "deck-danger",
  recentDeckIds: ["deck-danger", "deck-empty", "deck-missing", "deck-love"],
  tombstones: { sections: {}, decks: {}, cards: {} },
  preferences: {
    pinnedDeckIds: [],
    recentDecks: [
      { id: "deck-danger", viewedAt: viewedDanger },
      { id: "deck-empty", viewedAt: viewedDanger - 1 },
      { id: "deck-missing", viewedAt: viewedDanger - 2 },
      { id: "deck-love", viewedAt: viewedLove },
    ],
    deckLastViewed: {},
    theme: "dark",
    accentColor: "blue",
    updatedAt: viewedDanger,
  },
};

type RecentResponse = {
  exists?: boolean;
  items?: Array<{
    viewedAt: string | null;
    card: { id: string; term: string; definition: string };
    deck: { id: string; title: string };
    section: { id: string; title: string };
  }>;
};

const getRecent = async (id: string, query = "") => {
  const response = await fetch(`${baseUrl}/api/libraries/${id}/recent${query}`);
  return { status: response.status, payload: (await response.json()) as RecentResponse };
};

beforeAll(async () => {
  serverProcess = spawn("node", ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_MEMORY_STORAGE: "true",
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
  if (response.status !== 200) throw new Error(await response.text());
}, 30000);

afterAll(() => {
  serverProcess?.kill();
});

describe("GET /api/libraries/:syncKey/recent", () => {
  it("returns the last card in each recently viewed deck, newest first", async () => {
    const { status, payload } = await getRecent(libraryId);

    expect(status).toBe(200);
    expect(payload.exists).toBe(true);
    expect(payload.items?.map((item) => item.card.term)).toEqual(["hazard", "adore"]);
    expect(payload.items?.[0]).toMatchObject({
      viewedAt: new Date(viewedDanger).toISOString(),
      deck: { id: "deck-danger", title: "Danger" },
      section: { title: "Oxford Dictionaries" },
      card: { id: "card-1", definition: "a source of danger" },
    });
  });

  it("falls back to the deck's first card when the saved one is gone", async () => {
    const { payload } = await getRecent(libraryId);
    expect(payload.items?.[1].card.id).toBe("card-2");
  });

  it("honours ?limit=", async () => {
    const { payload } = await getRecent(libraryId, "?limit=1");
    expect(payload.items).toHaveLength(1);
  });

  it("never returns the library itself", async () => {
    const { payload } = await getRecent(libraryId);
    const body = JSON.stringify(payload);
    expect(body).not.toContain("librarySections");
    expect(body).not.toContain("knownIds");
    expect(body).not.toContain("peril");
  });

  it("reports an unknown library as empty", async () => {
    const { status, payload } = await getRecent("library-nobody-has");
    expect(status).toBe(200);
    expect(payload).toMatchObject({ exists: false, items: [] });
  });

  it("rejects malformed ids and other methods", async () => {
    expect((await getRecent("short")).status).toBe(400);
    const response = await fetch(`${baseUrl}/api/libraries/${libraryId}/recent`, {
      method: "POST",
    });
    expect(response.status).toBe(405);
  });
});

describe("resolveRecentCards", () => {
  it("reads v1 snapshots that only have recentDeckIds", () => {
    const items = resolveRecentCards({ ...snapshot, preferences: undefined });
    expect(items.map((item) => item.card.term)).toEqual(["hazard", "adore"]);
    expect(items[0].viewedAt).toBeNull();
  });

  it("clamps the limit", () => {
    expect(parseRecentLimit(null)).toBe(5);
    expect(parseRecentLimit("0")).toBe(5);
    expect(parseRecentLimit("abc")).toBe(5);
    expect(parseRecentLimit("500")).toBe(20);
  });
});
