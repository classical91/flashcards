import { describe, expect, it } from "vitest";
import { DeckSection } from "../../data/deckBuilder";
import { DeckProgress } from "../../data/librarySnapshot";
import { parseDailyCard, pickDailyCard, toDateKey } from "../dailyCard";

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
