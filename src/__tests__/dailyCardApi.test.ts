import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pickDailyCard, toDateKey } from "../lib/dailyCard";

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

// ── One Card of the Day per library per date ────────────────────────────────
//
// Before this, the server re-ran the pick on every request against whatever
// was marked known by then, while the app pinned its own pick in one browser.
// Marking the day's card known moved Main Hub to a different card than the one
// Flashcards was still showing. These run against the real server and its
// stored pick.

const cardsFor = (deckId: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${deckId}-card-${index}`,
    term: `${deckId} term ${index}`,
    definition: `${deckId} definition ${index}`,
  }));

const librarySectionsFor = () => [
  {
    id: "section-gpt",
    title: "GPT",
    description: "",
    decks: [
      { id: "deck-a", title: "Deck A", subtitle: "", cards: cardsFor("deck-a", 5) },
      { id: "deck-b", title: "Deck B", subtitle: "", cards: cardsFor("deck-b", 4) },
    ],
  },
];

type Sections = ReturnType<typeof librarySectionsFor>;

const progressFor = (knownByDeck: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(knownByDeck).map(([deckId, knownIds]) => [
      deckId,
      { currentCardId: knownIds[0] ?? "", knownIds, isFlipped: false, studyMode: "all" },
    ]),
  );

const putLibrary = async (
  id: string,
  librarySections: Sections,
  knownByDeck: Record<string, string[]> = {},
) => {
  const response = await fetch(`${baseUrl}/api/libraries/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      librarySections,
      deckProgress: progressFor(knownByDeck),
      selectedDeckId: librarySections[0]?.decks[0]?.id ?? "",
    }),
  });
  expect(response.status).toBe(200);
};

const deckOf = (cardId: string) => cardId.split("-card-")[0];

const dayAfter = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return toDateKey(new Date(year, month - 1, day + 1));
};

describe("the canonical Card of the Day", () => {
  // "Today" as the caller sees it — the only days the server pins a card for.
  const today = toDateKey(new Date());
  let nextId = 0;
  const freshLibrary = async (knownByDeck: Record<string, string[]> = {}) => {
    nextId += 1;
    const id = `library-canonical-${nextId}`;
    await putLibrary(id, librarySectionsFor(), knownByDeck);
    return id;
  };

  it("keeps the day's card after it is marked known (the original mismatch)", async () => {
    const id = await freshLibrary();
    const first = await getDailyCard(id, `?date=${today}`);
    const pickedId = first.payload.card!.id;

    await putLibrary(id, librarySectionsFor(), { [deckOf(pickedId)]: [pickedId] });

    // What the old route would have answered now: a different card.
    const recomputed = pickDailyCard(
      librarySectionsFor(),
      progressFor({ [deckOf(pickedId)]: [pickedId] }) as never,
      today,
    );
    expect(recomputed?.cardId).not.toBe(pickedId);

    const again = await getDailyCard(id, `?date=${today}`);
    expect(again.payload.card?.id).toBe(pickedId);
  });

  it("keeps the day's card through unrelated progress and reviews", async () => {
    const id = await freshLibrary();
    const pickedId = (await getDailyCard(id, `?date=${today}`)).payload.card!.id;
    const others = librarySectionsFor()
      .flatMap((section) => section.decks.flatMap((deck) => deck.cards.map((card) => card.id)))
      .filter((cardId) => cardId !== pickedId);

    await putLibrary(id, librarySectionsFor(), {
      "deck-a": others.filter((cardId) => deckOf(cardId) === "deck-a"),
      "deck-b": others.filter((cardId) => deckOf(cardId) === "deck-b"),
    });

    expect((await getDailyCard(id, `?date=${today}`)).payload.card?.id).toBe(pickedId);
  });

  it("serves every device and Main Hub the same card", async () => {
    const id = await freshLibrary();
    // Phone, laptop and the dashboard all ask; none of them can tell the others apart.
    const answers = await Promise.all(
      Array.from({ length: 3 }, () => getDailyCard(id, `?date=${today}`)),
    );
    const ids = new Set(answers.map((answer) => answer.payload.card?.id));
    expect(ids.size).toBe(1);
  });

  it("settles simultaneous first requests on one card", async () => {
    const id = await freshLibrary();
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => getDailyCard(id, `?date=${today}`)),
    );
    expect(answers.every((answer) => answer.status === 200)).toBe(true);
    expect(new Set(answers.map((answer) => answer.payload.card?.id)).size).toBe(1);
  });

  it("replaces a deleted card with one that exists, and keeps the replacement", async () => {
    const id = await freshLibrary();
    const pickedId = (await getDailyCard(id, `?date=${today}`)).payload.card!.id;

    const without = librarySectionsFor().map((section) => ({
      ...section,
      decks: section.decks.map((deck) => ({
        ...deck,
        cards: deck.cards.filter((card) => card.id !== pickedId),
      })),
    }));
    await putLibrary(id, without);

    const replaced = await getDailyCard(id, `?date=${today}`);
    const remaining = without.flatMap((s) => s.decks.flatMap((d) => d.cards.map((c) => c.id)));
    expect(replaced.payload.card?.id).not.toBe(pickedId);
    expect(remaining).toContain(replaced.payload.card?.id);

    // The deleted card coming back from a stale device does not take the slot back.
    await putLibrary(id, librarySectionsFor());
    expect((await getDailyCard(id, `?date=${today}`)).payload.card?.id).toBe(
      replaced.payload.card?.id,
    );
  });

  it("shows a renamed deck under its new name without moving the card", async () => {
    const id = await freshLibrary();
    const first = (await getDailyCard(id, `?date=${today}`)).payload;
    const renamed = librarySectionsFor().map((section) => ({
      ...section,
      decks: [
        ...section.decks.map((deck) =>
          deck.id === first.deck?.id ? { ...deck, title: "Renamed deck" } : deck,
        ),
        { id: "deck-new", title: "New deck", subtitle: "", cards: cardsFor("deck-new", 3) },
      ],
    }));
    await putLibrary(id, renamed);

    const again = (await getDailyCard(id, `?date=${today}`)).payload;
    expect(again.card?.id).toBe(first.card?.id);
    expect(again.deck?.title).toBe("Renamed deck");
  });

  it("gives the next day its own pick from the progress of the time", async () => {
    const id = await freshLibrary();
    const pickedId = (await getDailyCard(id, `?date=${today}`)).payload.card!.id;
    const known = { [deckOf(pickedId)]: [pickedId] };
    await putLibrary(id, librarySectionsFor(), known);

    const tomorrow = dayAfter(today);
    const next = await getDailyCard(id, `?date=${tomorrow}`);
    expect(next.payload.dateKey).toBe(tomorrow);
    expect(next.payload.card?.id).toBe(
      pickDailyCard(librarySectionsFor(), progressFor(known) as never, tomorrow)?.cardId,
    );
    expect(next.payload.card?.id).not.toBe(pickedId);
  });

  it("answers an empty library with no card, and pins once cards arrive", async () => {
    nextId += 1;
    const id = `library-canonical-${nextId}`;
    await putLibrary(id, [{ ...librarySectionsFor()[0], decks: [] }]);

    const empty = await getDailyCard(id, `?date=${today}`);
    expect(empty.status).toBe(200);
    expect(empty.payload.exists).toBe(true);
    expect(empty.payload.card).toBeNull();

    await putLibrary(id, librarySectionsFor());
    const first = await getDailyCard(id, `?date=${today}`);
    expect(first.payload.card?.id).toBe(pickDailyCard(librarySectionsFor(), {}, today)?.cardId);
  });

  it("never changes the library or its progress", async () => {
    const id = await freshLibrary({ "deck-a": ["deck-a-card-0"] });
    const before = await (await fetch(`${baseUrl}/api/libraries/${id}`)).json();

    await getDailyCard(id, `?date=${today}`);
    await getDailyCard(id, `?date=${dayAfter(today)}`);

    const after = await (await fetch(`${baseUrl}/api/libraries/${id}`)).json();
    expect(after.revision).toBe(before.revision);
    expect(after.snapshot).toEqual(before.snapshot);
  });

  it("lets an offline device's progress sync without moving the card", async () => {
    const id = await freshLibrary();
    const pickedId = (await getDailyCard(id, `?date=${today}`)).payload.card!.id;
    const { revision } = await (await fetch(`${baseUrl}/api/libraries/${id}`)).json();

    // The device comes back online and saves what it studied, against the
    // revision it last saw: the daily pick must not have bumped it.
    const known = { [deckOf(pickedId)]: [pickedId], "deck-b": ["deck-b-card-1"] };
    const save = await fetch(`${baseUrl}/api/libraries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": String(revision) },
      body: JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        librarySections: librarySectionsFor(),
        deckProgress: progressFor(known),
        selectedDeckId: "deck-a",
      }),
    });
    expect(save.status).toBe(200);

    const stored = await (await fetch(`${baseUrl}/api/libraries/${id}`)).json();
    expect(stored.snapshot.deckProgress).toEqual(progressFor(known));
    expect((await getDailyCard(id, `?date=${today}`)).payload.card?.id).toBe(pickedId);
  });

  it("keeps the response Main Hub reads, and only that", async () => {
    const id = await freshLibrary();
    const { payload } = await getDailyCard(id, `?date=${today}`);
    expect(payload.exists).toBe(true);
    expect(payload.dateKey).toBe(today);
    expect(Object.keys(payload.card ?? {}).sort()).toEqual(["definition", "id", "term"]);
    expect(Object.keys(payload.deck ?? {}).sort()).toEqual(["id", "subtitle", "title"]);
    expect(Object.keys(payload.section ?? {}).sort()).toEqual(["id", "title"]);
    const body = JSON.stringify(payload);
    expect(body).not.toContain("knownIds");
    expect(body).not.toContain("librarySections");
    expect(body).not.toContain(id);
  });

  it("does not create a library by being asked about one", async () => {
    const missing = "library-canonical-never-saved";
    const { payload } = await getDailyCard(missing, `?date=${today}`);
    expect(payload.exists).toBe(false);
    const library = await (await fetch(`${baseUrl}/api/libraries/${missing}`)).json();
    expect(library.exists).toBe(false);
  });
});
