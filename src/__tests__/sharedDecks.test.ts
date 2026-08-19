import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSharedDeckSnapshot } from "../data/sharedDeck";
import { buildShareUrl, getShareIdFromPath, importSharedDeck, isShareIdValid } from "../lib/share";
import type { DeckSection } from "../data/deckBuilder";
import type { SharedDeckSnapshot } from "../data/sharedDeck";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 4603;
const baseUrl = `http://127.0.0.1:${port}`;
// Ports are hardcoded per test file and vitest runs files in parallel, so this
// must not collide with adminLibraries (4599/4600) or snapshotLimits (4601).

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

const sampleDeck = {
  id: "shared-deck",
  title: "Positive Adjectives",
  subtitle: "Words that lift a sentence.",
  cards: [
    { id: "card-0", term: "buoyant", definition: "cheerful and optimistic" },
    { id: "card-1", term: "candid", definition: "truthful and straightforward" },
  ],
};

const sampleSection = {
  id: "gpt",
  title: "GPT",
  description: "Decks drafted with GPT.",
};

const shareDeck = async (body: unknown) =>
  fetch(`${baseUrl}/api/shared-decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

  await waitForServer();
}, 30000);

afterAll(() => {
  serverProcess?.kill();
});

describe("share link paths", () => {
  it("reads a share id back out of the link the app hands out", () => {
    const shareId = "AbCd012345_-xyz";
    const url = new URL(buildShareUrl(shareId, "https://flashcards.example"));
    expect(getShareIdFromPath(url.pathname)).toBe(shareId);
  });

  it("tolerates a trailing slash", () => {
    expect(getShareIdFromPath("/d/AbCd012345/")).toBe("AbCd012345");
  });

  it("ignores paths that are not share links", () => {
    expect(getShareIdFromPath("/")).toBeNull();
    expect(getShareIdFromPath("/admin")).toBeNull();
    expect(getShareIdFromPath("/deck/AbCd012345")).toBeNull();
  });

  it("rejects ids the server would refuse, so no request is made for them", () => {
    // Shorter than the server's 10-character minimum.
    expect(getShareIdFromPath("/d/short")).toBeNull();
    expect(getShareIdFromPath("/d/")).toBeNull();
    expect(getShareIdFromPath("/d/has spaces here")).toBeNull();
    expect(getShareIdFromPath(`/d/${"a".repeat(121)}`)).toBeNull();
    expect(isShareIdValid("../../etc/passwd")).toBe(false);
  });

  it("does not throw on a malformed percent-encoded path", () => {
    expect(getShareIdFromPath("/d/%E0%A4%A")).toBeNull();
  });
});

describe("POST /api/shared-decks", () => {
  it("round-trips a deck through a share link", async () => {
    const created = await shareDeck({ deck: sampleDeck, section: sampleSection });
    expect(created.status).toBe(200);

    const { shareId } = (await created.json()) as { shareId: string };
    expect(isShareIdValid(shareId)).toBe(true);

    const fetched = await fetch(`${baseUrl}/api/shared-decks/${shareId}`);
    expect(fetched.status).toBe(200);

    const payload = (await fetched.json()) as { snapshot: unknown };
    const snapshot = parseSharedDeckSnapshot(payload.snapshot);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.deck.title).toBe(sampleDeck.title);
    expect(snapshot?.deck.cards).toHaveLength(2);
    expect(snapshot?.section.title).toBe(sampleSection.title);
  });

  it("mints a distinct id per share, so one link cannot overwrite another", async () => {
    const first = await shareDeck({ deck: sampleDeck, section: sampleSection });
    const second = await shareDeck({ deck: sampleDeck, section: sampleSection });
    const firstId = ((await first.json()) as { shareId: string }).shareId;
    const secondId = ((await second.json()) as { shareId: string }).shareId;
    expect(firstId).not.toBe(secondId);
  });

  it("rejects a deck that is missing required fields", async () => {
    const response = await shareDeck({
      deck: { id: "no-subtitle", title: "Broken", cards: [] },
      section: sampleSection,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a request with no section", async () => {
    const response = await shareDeck({ deck: sampleDeck });
    expect(response.status).toBe(400);
  });
});

describe("GET /api/shared-decks/:shareId", () => {
  it("404s an id that was never shared", async () => {
    const response = await fetch(`${baseUrl}/api/shared-decks/neverSharedId123`);
    expect(response.status).toBe(404);
  });

  it("400s a malformed id", async () => {
    const response = await fetch(`${baseUrl}/api/shared-decks/short`);
    expect(response.status).toBe(400);
  });

  it("refuses to write through the read route", async () => {
    const response = await fetch(`${baseUrl}/api/shared-decks/neverSharedId123`, {
      method: "DELETE",
    });
    expect(response.status).toBe(405);
  });
});

describe("parseSharedDeckSnapshot", () => {
  it("rejects a deck without a subtitle rather than typing it as complete", () => {
    expect(
      parseSharedDeckSnapshot({
        version: 1,
        sharedAt: new Date().toISOString(),
        deck: { id: "d", title: "T", cards: [] },
        section: sampleSection,
      }),
    ).toBeNull();
  });

  it("rejects an unknown snapshot version", () => {
    expect(
      parseSharedDeckSnapshot({
        version: 2,
        sharedAt: new Date().toISOString(),
        deck: sampleDeck,
        section: sampleSection,
      }),
    ).toBeNull();
  });
});

const snapshotOf = (deck = sampleDeck, section = sampleSection): SharedDeckSnapshot => ({
  version: 1,
  sharedAt: new Date().toISOString(),
  deck,
  section,
});

const libraryWith = (decks: DeckSection["decks"]): DeckSection[] => [
  { id: "gpt", title: "GPT", description: "Decks drafted with GPT.", decks },
];

const cardIdsIn = (sections: DeckSection[], sectionId: string) =>
  sections
    .find((section) => section.id === sectionId)!
    .decks.flatMap((deck) => deck.cards.map((card) => card.id));

describe("importSharedDeck", () => {
  it("files the deck under a topic the reader already has", () => {
    const { sections, deck } = importSharedDeck(libraryWith([]), snapshotOf());
    expect(sections).toHaveLength(1);
    expect(sections[0].decks.map((item) => item.id)).toEqual([deck.id]);
  });

  it("matches an existing topic by name when the id differs", () => {
    const snapshot = snapshotOf(sampleDeck, { ...sampleSection, id: "gpt-from-elsewhere" });
    const { sections } = importSharedDeck(libraryWith([]), snapshot);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("gpt");
  });

  it("creates the topic when the reader does not have it", () => {
    const snapshot = snapshotOf(sampleDeck, {
      id: "oxford",
      title: "Oxford Dictionaries",
      description: "Dictionary decks.",
    });
    const { sections, deck } = importSharedDeck(libraryWith([]), snapshot);
    expect(sections).toHaveLength(2);
    expect(sections[1].title).toBe("Oxford Dictionaries");
    expect(sections[1].decks).toEqual([deck]);
  });

  it("does not overwrite a deck the reader already has under the same id", () => {
    const existing = { ...sampleDeck, id: "positive-adjectives", title: "Positive Adjectives" };
    const before = libraryWith([existing]);
    const { sections, deck } = importSharedDeck(before, snapshotOf());

    expect(deck.id).not.toBe(existing.id);
    expect(sections[0].decks).toHaveLength(2);
    expect(sections[0].decks[0]).toEqual(existing);
  });

  it("re-mints card ids so a share cannot collide inside the target topic", () => {
    const existing = {
      id: "other-deck",
      title: "Other deck",
      subtitle: "",
      cards: [{ id: "card-0", term: "existing", definition: "already here" }],
    };
    const { sections } = importSharedDeck(libraryWith([existing]), snapshotOf());
    const cardIds = cardIdsIn(sections, "gpt");

    expect(new Set(cardIds).size).toBe(cardIds.length);
    // The reader's own card keeps its id; the incoming duplicate is the one moved.
    expect(cardIds).toContain("card-0");
  });

  it("leaves the caller's sections untouched", () => {
    const before = libraryWith([]);
    const snapshotBefore = JSON.stringify(before);
    importSharedDeck(before, snapshotOf());
    expect(JSON.stringify(before)).toBe(snapshotBefore);
  });

  it("keeps importing the same link into distinct decks", () => {
    const first = importSharedDeck(libraryWith([]), snapshotOf());
    const second = importSharedDeck(first.sections, snapshotOf());
    const third = importSharedDeck(second.sections, snapshotOf());
    const deckIds = third.sections[0].decks.map((deck) => deck.id);

    expect(deckIds).toHaveLength(3);
    expect(new Set(deckIds).size).toBe(3);
  });
});
