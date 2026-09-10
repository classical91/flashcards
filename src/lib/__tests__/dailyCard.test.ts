import { describe, expect, it } from "vitest";
import { DeckSection } from "../../data/deckBuilder";
import { DeckProgress } from "../../data/librarySnapshot";
import { parseDailyCard, pickDailyCard, toDateKey } from "../dailyCard";
// The server's copy of this rule, checked against the app's at the bottom of
// this file. See the header of server-daily-card.mjs for why a copy exists.
import {
  parseDateKey as serverParseDateKey,
  pickDailyCard as serverPickDailyCard,
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
