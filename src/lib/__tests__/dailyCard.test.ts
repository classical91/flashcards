import { describe, expect, it } from "vitest";
import { DeckSection } from "../../data/deckBuilder";
import { DeckProgress } from "../../data/librarySnapshot";
import {
  dailyCardExists,
  isConfirmedFor,
  parseCanonicalDailyCard,
  parseDailyCard,
  pickDailyCard,
  reconcileDailyCard,
  toDateKey,
} from "../dailyCard";
// The server's copy of this rule, checked against the app's at the bottom of
// this file. See the header of server-daily-card.mjs for why a copy exists.
import {
  type DailyCardStore,
  type StoredDailyCard,
  isCanonicalDateKey,
  oldestCanonicalDateKey,
  parseDateKey as serverParseDateKey,
  pickDailyCard as serverPickDailyCard,
  resolveCanonicalDailyCard,
  resolveDailyCard as serverResolveDailyCard,
  toDateKey as serverToDateKey,
} from "../../../server-daily-card.mjs";

const card = (id: string) => ({ id, term: `term-${id}`, definition: `definition-${id}` });

const sections: DeckSection[] = [
  {
    id: "topic-a",
    title: "Topic A",
    description: "",
    decks: [
      { id: "deck-1", title: "Deck 1", subtitle: "", cards: [card("c1"), card("c2")] },
      { id: "deck-2", title: "Deck 2", subtitle: "", cards: [card("c3")] },
    ],
  },
  {
    id: "topic-b",
    title: "Topic B",
    description: "",
    decks: [{ id: "deck-3", title: "Deck 3", subtitle: "", cards: [card("c4")] }],
  },
];

const progress = (knownByDeck: Record<string, string[]>): Record<string, DeckProgress> =>
  Object.fromEntries(
    Object.entries(knownByDeck).map(([deckId, knownIds]) => [
      deckId,
      { currentCardId: "", knownIds, isFlipped: false, studyMode: "all" as const },
    ]),
  );

describe("toDateKey", () => {
  it("formats the local calendar day, zero padded", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses the local day rather than the UTC day", () => {
    // 23:30 local on the 5th is already the 6th in UTC for negative offsets;
    // the key should still say the 5th.
    const late = new Date(2026, 5, 5, 23, 30);
    expect(toDateKey(late)).toBe("2026-06-05");
  });
});

describe("pickDailyCard", () => {
  it("returns the same card for the same day", () => {
    const first = pickDailyCard(sections, {}, "2026-07-27");
    const second = pickDailyCard(sections, {}, "2026-07-27");
    expect(first).not.toBeNull();
    expect(first).toEqual(second);
  });

  it("picks a card that actually exists in the library", () => {
    const picked = pickDailyCard(sections, {}, "2026-07-27");
    const deck = sections.flatMap((s) => s.decks).find((d) => d.id === picked?.deckId);
    expect(deck).toBeDefined();
    expect(deck?.cards.some((c) => c.id === picked?.cardId)).toBe(true);
  });

  it("varies across days rather than pinning one card forever", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `2026-07-${`${i + 1}`.padStart(2, "0")}`);
    const picked = new Set(keys.map((key) => pickDailyCard(sections, {}, key)?.cardId));
    expect(picked.size).toBeGreaterThan(1);
  });

  it("skips cards already marked known", () => {
    const known = progress({ "deck-1": ["c1", "c2"], "deck-2": ["c3"] });
    for (let day = 1; day <= 31; day += 1) {
      const picked = pickDailyCard(sections, known, `2026-07-${`${day}`.padStart(2, "0")}`);
      expect(picked?.cardId).toBe("c4");
    }
  });

  it("falls back to the full library once every card is known", () => {
    const known = progress({
      "deck-1": ["c1", "c2"],
      "deck-2": ["c3"],
      "deck-3": ["c4"],
    });
    const picked = pickDailyCard(sections, known, "2026-07-27");
    expect(picked).not.toBeNull();
    expect(["c1", "c2", "c3", "c4"]).toContain(picked?.cardId);
  });

  it("returns null when there is nothing to study", () => {
    expect(pickDailyCard([], {}, "2026-07-27")).toBeNull();
    expect(
      pickDailyCard(
        [{ id: "empty", title: "Empty", description: "", decks: [] }],
        {},
        "2026-07-27",
      ),
    ).toBeNull();
  });

  it("stamps the pick with the day it was made for", () => {
    expect(pickDailyCard(sections, {}, "2026-07-27")?.dateKey).toBe("2026-07-27");
  });
});

describe("parseDailyCard", () => {
  it("accepts a well formed reference", () => {
    const ref = { dateKey: "2026-07-27", deckId: "deck-1", cardId: "c1" };
    expect(parseDailyCard(ref)).toEqual(ref);
  });

  it("keeps the cloud's confirmation, and nothing that merely looks like one", () => {
    const ref = { dateKey: "2026-07-27", deckId: "deck-1", cardId: "c1" };
    expect(parseDailyCard({ ...ref, confirmed: true })).toEqual({ ...ref, confirmed: true });
    expect(parseDailyCard({ ...ref, confirmed: "yes" })).toEqual(ref);
    // A pin saved before the canonical pick existed loads as unconfirmed.
    expect(parseDailyCard(ref)?.confirmed).toBeUndefined();
  });

  it("rejects malformed or missing values", () => {
    expect(parseDailyCard(null)).toBeNull();
    expect(parseDailyCard("nope")).toBeNull();
    expect(parseDailyCard({ dateKey: "2026-07-27", deckId: "deck-1" })).toBeNull();
    expect(parseDailyCard({ dateKey: 1, deckId: "deck-1", cardId: "c1" })).toBeNull();
  });
});

// ── Server parity ───────────────────────────────────────────────────────────
//
// server-daily-card.mjs restates pickDailyCard and toDateKey so the untranspiled
// Node server can serve the Card of the Day to Main Hub's Daily Dashboard. Two
// copies of one rule drift silently, so these run both over the same fixtures.
// Change src/lib/dailyCard.ts without changing the server copy and this fails.

describe("server parity", () => {
  const days = Array.from(
    { length: 60 },
    (_, i) => `2026-${`${(i % 12) + 1}`.padStart(2, "0")}-${`${(i % 28) + 1}`.padStart(2, "0")}`,
  );

  it("picks the same card as the app for every day and progress state", () => {
    const states = [
      {},
      progress({ "deck-1": ["c1"] }),
      progress({ "deck-1": ["c1", "c2"], "deck-2": ["c3"] }),
      progress({ "deck-1": ["c1", "c2"], "deck-2": ["c3"], "deck-3": ["c4"] }),
    ];

    for (const state of states) {
      for (const day of days) {
        expect(serverPickDailyCard(sections, state, day)).toEqual(
          pickDailyCard(sections, state, day),
        );
      }
    }
  });

  it("formats date keys the same way, local day included", () => {
    expect(serverToDateKey(new Date(2026, 0, 5))).toBe(toDateKey(new Date(2026, 0, 5)));
    expect(serverToDateKey(new Date(2026, 5, 5, 23, 30))).toBe(
      toDateKey(new Date(2026, 5, 5, 23, 30)),
    );
  });

  it("agrees that an empty library has no card", () => {
    expect(serverPickDailyCard([], {}, "2026-07-27")).toBeNull();
    expect(pickDailyCard([], {}, "2026-07-27")).toBeNull();
  });
});

describe("parseDateKey", () => {
  it("accepts a real calendar day", () => {
    expect(serverParseDateKey("2026-07-27")).toBe("2026-07-27");
    expect(serverParseDateKey(" 2026-02-28 ")).toBe("2026-02-28");
  });

  it("rejects days that do not exist and anything malformed", () => {
    expect(serverParseDateKey("2026-02-31")).toBeNull();
    expect(serverParseDateKey("2025-02-29")).toBeNull();
    expect(serverParseDateKey("2026-13-01")).toBeNull();
    expect(serverParseDateKey("26-07-27")).toBeNull();
    expect(serverParseDateKey("")).toBeNull();
    expect(serverParseDateKey(null)).toBeNull();
  });
});

describe("resolveDailyCard", () => {
  const snapshot = { librarySections: sections, deckProgress: progress({ "deck-1": ["c1"] }) };

  it("returns the resolved card, its deck and its topic", () => {
    const reference = pickDailyCard(sections, snapshot.deckProgress, "2026-07-27");
    const resolved = serverResolveDailyCard(snapshot, "2026-07-27");

    expect(resolved?.card.id).toBe(reference?.cardId);
    expect(resolved?.deck.id).toBe(reference?.deckId);
    expect(resolved?.section.title).toMatch(/^Topic /);
    expect(resolved?.dateKey).toBe("2026-07-27");
  });

  it("hands back one card and nothing resembling the library", () => {
    const resolved = serverResolveDailyCard(snapshot, "2026-07-27");

    expect(Object.keys(resolved ?? {}).sort()).toEqual(["card", "dateKey", "deck", "section"]);
    expect(Object.keys(resolved?.deck ?? {}).sort()).toEqual(["id", "subtitle", "title"]);
    expect(resolved?.deck).not.toHaveProperty("cards");
    expect(JSON.stringify(resolved)).not.toContain("knownIds");
  });

  it("survives a snapshot with nothing in it", () => {
    expect(serverResolveDailyCard({}, "2026-07-27")).toBeNull();
    expect(serverResolveDailyCard({ librarySections: [] }, "2026-07-27")).toBeNull();
  });
});

// ── Canonical Card of the Day ───────────────────────────────────────────────
//
// The bug these cover: the app pinned its pick in one browser's localStorage,
// while the server re-ran pickDailyCard on every request against whatever was
// known by then. Mark the day's card known and the two disagreed — and every
// device that picked before its cloud merge landed could disagree too.

/** The server's selection storage, as a Map with the same compare-and-swap. */
const memoryStore = () => {
  const rows = new Map<string, StoredDailyCard>();
  let writes = 0;
  const store: DailyCardStore = {
    get: async (dateKey) => rows.get(dateKey) ?? null,
    claim: async (dateKey, expected, next) => {
      const current = rows.get(dateKey) ?? null;
      const matches = expected
        ? current?.deckId === expected.deckId && current?.cardId === expected.cardId
        : current === null;
      if (matches) {
        rows.set(dateKey, next);
        writes += 1;
      }
      return rows.get(dateKey) ?? null;
    },
  };
  return { store, rows, writes: () => writes };
};

const snapshotOf = (
  librarySections: DeckSection[],
  knownByDeck: Record<string, string[]> = {},
) => ({
  librarySections,
  deckProgress: progress(knownByDeck),
});

const markKnown = (cardId: string) => {
  const deck = sections.flatMap((s) => s.decks).find((d) => d.cards.some((c) => c.id === cardId));
  return { [deck!.id]: [cardId] };
};

describe("resolveCanonicalDailyCard", () => {
  const day = "2026-10-19";

  it("reproduces the original mismatch with the fresh pick", () => {
    // The old server behaviour, kept here as the regression's baseline: the
    // fresh pick moves the moment the day's card is marked known.
    const before = serverResolveDailyCard(snapshotOf(sections), day);
    const after = serverResolveDailyCard(snapshotOf(sections, markKnown(before!.card.id)), day);
    expect(after?.card.id).not.toBe(before?.card.id);
  });

  it("keeps the first pick after the day's card is marked known", async () => {
    const { store } = memoryStore();
    const first = await resolveCanonicalDailyCard(snapshotOf(sections), day, store);
    expect(first?.card.id).toBe(pickDailyCard(sections, {}, day)?.cardId);

    const known = snapshotOf(sections, markKnown(first!.card.id));
    const again = await resolveCanonicalDailyCard(known, day, store);
    expect(again?.card.id).toBe(first?.card.id);
    expect(again?.deck.id).toBe(first?.deck.id);
  });

  it("keeps the first pick through unrelated progress", async () => {
    const { store } = memoryStore();
    const first = await resolveCanonicalDailyCard(snapshotOf(sections), day, store);
    const others = ["c1", "c2", "c3", "c4"].filter((id) => id !== first?.card.id);
    for (const id of others) {
      const later = await resolveCanonicalDailyCard(
        snapshotOf(sections, markKnown(id)),
        day,
        store,
      );
      expect(later?.card.id).toBe(first?.card.id);
    }
  });

  it("settles two simultaneous first requests on one card", async () => {
    const { store, writes } = memoryStore();
    // The second device has already marked the first device's card known, so
    // left to itself it would pick a different one.
    const fresh = pickDailyCard(sections, {}, day)!;
    const [a, b] = await Promise.all([
      resolveCanonicalDailyCard(snapshotOf(sections), day, store),
      resolveCanonicalDailyCard(snapshotOf(sections, markKnown(fresh.cardId)), day, store),
    ]);
    expect(a?.card.id).toBe(b?.card.id);
    expect(writes()).toBe(1);
  });

  it("replaces a pick whose card was deleted, with a card that exists", async () => {
    const { store, rows } = memoryStore();
    const first = await resolveCanonicalDailyCard(snapshotOf(sections), day, store);
    const without = sections.map((section) => ({
      ...section,
      decks: section.decks.map((deck) => ({
        ...deck,
        cards: deck.cards.filter((c) => c.id !== first?.card.id),
      })),
    }));

    const replaced = await resolveCanonicalDailyCard(snapshotOf(without), day, store);
    expect(replaced).not.toBeNull();
    expect(replaced?.card.id).not.toBe(first?.card.id);
    expect(dailyCardExists(without, { dateKey: day, ...rows.get(day)! })).toBe(true);

    // And the replacement is now the day's card in turn.
    const again = await resolveCanonicalDailyCard(snapshotOf(without), day, store);
    expect(again?.card.id).toBe(replaced?.card.id);
  });

  it("shows a renamed deck under its new name", async () => {
    const { store } = memoryStore();
    const first = await resolveCanonicalDailyCard(snapshotOf(sections), day, store);
    const renamed = sections.map((section) => ({
      ...section,
      decks: section.decks.map((deck) =>
        deck.id === first?.deck.id ? { ...deck, title: "Renamed" } : deck,
      ),
    }));
    const again = await resolveCanonicalDailyCard(snapshotOf(renamed), day, store);
    expect(again?.card.id).toBe(first?.card.id);
    expect(again?.deck.title).toBe("Renamed");
  });

  it("gives each day its own pick", async () => {
    const { store, rows } = memoryStore();
    await resolveCanonicalDailyCard(snapshotOf(sections), day, store);
    const known = markKnown(rows.get(day)!.cardId);
    const tomorrow = await resolveCanonicalDailyCard(
      snapshotOf(sections, known),
      "2026-10-20",
      store,
    );
    expect(tomorrow?.card.id).toBe(pickDailyCard(sections, progress(known), "2026-10-20")?.cardId);
    expect(rows.size).toBe(2);
  });

  it("stores nothing for an empty library", async () => {
    const { store, writes } = memoryStore();
    expect(await resolveCanonicalDailyCard(snapshotOf([]), day, store)).toBeNull();
    expect(await resolveCanonicalDailyCard({}, day, store)).toBeNull();
    expect(writes()).toBe(0);
  });

  it("never touches the snapshot it reads", async () => {
    const { store } = memoryStore();
    const snapshot = snapshotOf(sections, { "deck-1": ["c1"] });
    const before = JSON.stringify(snapshot);
    await resolveCanonicalDailyCard(snapshot, day, store);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("isCanonicalDateKey", () => {
  const now = new Date(Date.UTC(2026, 9, 19, 12));

  it("covers every time zone's today and no further", () => {
    expect(isCanonicalDateKey("2026-10-19", now)).toBe(true);
    expect(isCanonicalDateKey("2026-10-18", now)).toBe(true);
    expect(isCanonicalDateKey("2026-10-21", now)).toBe(true);
    expect(isCanonicalDateKey("2026-10-16", now)).toBe(false);
    expect(isCanonicalDateKey("2026-10-22", now)).toBe(false);
    expect(isCanonicalDateKey("2020-01-01", now)).toBe(false);
  });

  it("names the oldest day still kept, across a month boundary", () => {
    expect(oldestCanonicalDateKey(now)).toBe("2026-10-17");
    expect(oldestCanonicalDateKey(new Date(Date.UTC(2026, 2, 1, 3)))).toBe("2026-02-27");
  });
});

describe("reconcileDailyCard", () => {
  const legacy = { dateKey: "2026-10-19", deckId: "deck-1", cardId: "c1" };
  const canonical = { dateKey: "2026-10-19", deckId: "deck-3", cardId: "c4", confirmed: true };

  it("lets the cloud's pick replace a pin saved before it existed", () => {
    expect(reconcileDailyCard(legacy, canonical, sections)).toEqual(canonical);
    expect(isConfirmedFor(reconcileDailyCard(legacy, canonical, sections), "2026-10-19")).toBe(
      true,
    );
  });

  it("keeps the local pick when the cloud names a card this device lacks", () => {
    const missing = { ...canonical, cardId: "gone" };
    expect(reconcileDailyCard(legacy, missing, sections)).toEqual(legacy);
  });

  it("keeps the local pick when the cloud has no card", () => {
    expect(reconcileDailyCard(legacy, null, sections)).toEqual(legacy);
  });
});

describe("parseCanonicalDailyCard", () => {
  const payload = {
    exists: true,
    dateKey: "2026-10-19",
    card: { id: "c4", term: "t", definition: "d" },
    deck: { id: "deck-3", title: "Deck 3", subtitle: "" },
    section: { id: "topic-b", title: "Topic B" },
  };

  it("reads the endpoint's answer as a confirmed reference", () => {
    expect(parseCanonicalDailyCard(payload, "2026-10-19")).toEqual({
      dateKey: "2026-10-19",
      deckId: "deck-3",
      cardId: "c4",
      confirmed: true,
    });
  });

  it("ignores an answer for another day, an empty library or no library", () => {
    expect(parseCanonicalDailyCard(payload, "2026-10-20")).toBeNull();
    expect(parseCanonicalDailyCard({ ...payload, card: null }, "2026-10-19")).toBeNull();
    expect(
      parseCanonicalDailyCard({ exists: false, dateKey: "2026-10-19", card: null }, "2026-10-19"),
    ).toBeNull();
    expect(parseCanonicalDailyCard(null, "2026-10-19")).toBeNull();
  });
});
