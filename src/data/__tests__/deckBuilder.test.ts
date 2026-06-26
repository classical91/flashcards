import { describe, it, expect } from "vitest";
import {
  parsePastedFlashcards,
  createUniqueId,
  withCardIds,
  createDeckFromRaw,
  sanitizeDeckSections,
  MAX_ID_LENGTH,
  DeckSection,
} from "../deckBuilder";

describe("parsePastedFlashcards", () => {
  it("parses tab-separated lines (Quizlet format)", () => {
    const result = parsePastedFlashcards("adaptable\teasily adjustable\nadmirable\tdeserving respect");
    expect(result.cards).toEqual([
      { term: "adaptable", definition: "easily adjustable" },
      { term: "admirable", definition: "deserving respect" },
    ]);
    expect(result.invalidLines).toHaveLength(0);
  });

  it("parses spaced hyphen separator", () => {
    const result = parsePastedFlashcards("joy - a feeling of happiness");
    expect(result.cards).toEqual([
      { term: "joy", definition: "a feeling of happiness" },
    ]);
  });

  it("parses spaced en-dash separator", () => {
    const result = parsePastedFlashcards("joy – a feeling of happiness");
    expect(result.cards[0].term).toBe("joy");
    expect(result.cards[0].definition).toBe("a feeling of happiness");
  });

  it("parses unspaced en-dash separator", () => {
    const result = parsePastedFlashcards("Faith–Trust in something greater");
    expect(result.cards[0].term).toBe("Faith");
    expect(result.cards[0].definition).toBe("Trust in something greater");
  });

  it("parses colon separator", () => {
    const result = parsePastedFlashcards("courage: the ability to face fear");
    expect(result.cards).toEqual([
      { term: "courage", definition: "the ability to face fear" },
    ]);
  });

  it("returns invalid lines for unparseable input", () => {
    const result = parsePastedFlashcards("justoneword");
    expect(result.cards).toHaveLength(0);
    expect(result.invalidLines).toContain("justoneword");
  });

  it("skips blank lines", () => {
    const result = parsePastedFlashcards("term\tdef\n\n\nterm2\tdef2");
    expect(result.cards).toHaveLength(2);
  });

  it("trims whitespace from terms and definitions", () => {
    const result = parsePastedFlashcards("  joy  \t  happiness  ");
    expect(result.cards[0].term).toBe("joy");
    expect(result.cards[0].definition).toBe("happiness");
  });

  it("handles empty input", () => {
    const result = parsePastedFlashcards("");
    expect(result.cards).toHaveLength(0);
    expect(result.invalidLines).toHaveLength(0);
  });

  it("handles mixed valid and invalid lines", () => {
    const input = "term\tdef\nbadline\nterm2\tdef2";
    const result = parsePastedFlashcards(input);
    expect(result.cards).toHaveLength(2);
    expect(result.invalidLines).toEqual(["badline"]);
  });

  it("uses hyphen heuristic to split ambiguous lines", () => {
    const result = parsePastedFlashcards("Resilience-the ability to recover quickly from setbacks");
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].term).toBe("Resilience");
    expect(result.cards[0].definition).toMatch(/ability to recover/);
  });

  it("handles windows-style line endings", () => {
    const result = parsePastedFlashcards("term\tdef\r\nterm2\tdef2");
    expect(result.cards).toHaveLength(2);
  });
});

describe("createUniqueId", () => {
  it("converts text to a slug", () => {
    expect(createUniqueId("Common Compliments", new Set())).toBe("common-compliments");
  });

  it("appends a numeric suffix when the id already exists", () => {
    const existing = new Set(["common-compliments"]);
    expect(createUniqueId("Common Compliments", existing)).toBe("common-compliments-2");
  });

  it("increments the suffix past existing collisions", () => {
    const existing = new Set(["common-compliments", "common-compliments-2"]);
    expect(createUniqueId("Common Compliments", existing)).toBe("common-compliments-3");
  });

  it("falls back to 'deck' for empty input", () => {
    expect(createUniqueId("", new Set())).toBe("deck");
  });

  it("handles special characters by stripping them", () => {
    const id = createUniqueId("Words & Phrases!", new Set());
    expect(id).toBe("words-phrases");
  });

  it("converts to lowercase", () => {
    expect(createUniqueId("UPPERCASE", new Set())).toBe("uppercase");
  });

  it("collapses multiple special chars into one hyphen", () => {
    expect(createUniqueId("hello   world", new Set())).toBe("hello-world");
  });

  it("does not add suffix when id is unique in the set", () => {
    const existing = new Set(["other-deck"]);
    expect(createUniqueId("My Deck", existing)).toBe("my-deck");
  });

  it("caps the generated id length so it stays syncable", () => {
    const longTitle = "Word ".repeat(60);
    const id = createUniqueId(longTitle, new Set());
    expect(id.length).toBeLessThanOrEqual(MAX_ID_LENGTH);
  });
});

describe("sanitizeDeckSections", () => {
  const buildSection = (id: string, deckId: string, cardId: string): DeckSection[] => [
    {
      id,
      title: "Section",
      description: "",
      decks: [
        {
          id: deckId,
          title: "Deck",
          subtitle: "",
          cards: [{ id: cardId, term: "term", definition: "def" }],
        },
      ],
    },
  ];

  it("leaves already-valid sections untouched", () => {
    const sections = buildSection("section", "deck", "card");
    const result = sanitizeDeckSections(sections);
    expect(result.changed).toBe(false);
    expect(result.sections).toBe(sections);
  });

  it("shortens deck and card ids that exceed the limit", () => {
    const longDeckId = "deck-".repeat(40);
    const longCardId = "card-".repeat(40);
    const sections = buildSection("section", longDeckId, longCardId);
    const result = sanitizeDeckSections(sections);

    expect(result.changed).toBe(true);
    const [deck] = result.sections[0].decks;
    expect(deck.id.length).toBeLessThanOrEqual(MAX_ID_LENGTH);
    expect(deck.cards[0].id.length).toBeLessThanOrEqual(MAX_ID_LENGTH);
    expect(result.deckIdMap.get(longDeckId)).toBe(deck.id);
    expect(result.cardIdMap.get(longCardId)).toBe(deck.cards[0].id);
  });
});

describe("withCardIds", () => {
  it("assigns unique ids to cards that share a term", () => {
    const cards = withCardIds([
      { term: "Joy", definition: "a feeling of happiness" },
      { term: "Joy", definition: "great pleasure" },
      { term: "Joy", definition: "delight" },
    ]);
    expect(cards.map((card) => card.id)).toEqual(["joy", "joy-2", "joy-3"]);
  });

  it("seeds de-duplication from existing ids", () => {
    const cards = withCardIds(
      [{ term: "Joy", definition: "happiness" }],
      ["joy"],
    );
    expect(cards[0].id).toBe("joy-2");
  });

  it("trims terms and normalizes definitions", () => {
    const cards = withCardIds([
      { term: "  Joy  ", definition: "happiness,delight   and   cheer" },
    ]);
    expect(cards[0].term).toBe("Joy");
    expect(cards[0].definition).toBe("happiness, delight and cheer");
  });

  it("falls back to the 'deck' id for blank terms and still de-duplicates", () => {
    const cards = withCardIds([
      { term: "", definition: "first" },
      { term: "   ", definition: "second" },
    ]);
    expect(cards.map((card) => card.id)).toEqual(["deck", "deck-2"]);
  });
});

describe("createDeckFromRaw", () => {
  it("keeps protected terms intact instead of hyphen-splitting them", () => {
    const deck = createDeckFromRaw({
      id: "tech",
      title: "Tech",
      raw: "e-mail-electronic message sent over a network",
      protectedTerms: ["e-mail"],
    });
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].term).toBe("e-mail");
    expect(deck.cards[0].definition).toBe("electronic message sent over a network");
  });

  it("assigns unique ids when a protected term repeats", () => {
    const deck = createDeckFromRaw({
      id: "tech",
      title: "Tech",
      raw: "e-mail-first definition\ne-mail-second definition",
      protectedTerms: ["e-mail"],
    });
    expect(deck.cards.map((card) => card.id)).toEqual(["e-mail", "e-mail-2"]);
  });

  it("uses fallbackDefinitions when an entry cannot be split", () => {
    const deck = createDeckFromRaw({
      id: "calm",
      title: "Calm",
      raw: "Serenity",
      fallbackDefinitions: { Serenity: "the state of being calm and peaceful" },
    });
    expect(deck.cards[0].term).toBe("Serenity");
    expect(deck.cards[0].definition).toBe("the state of being calm and peaceful");
  });

  it("falls back to a placeholder definition for unsplittable entries", () => {
    const deck = createDeckFromRaw({
      id: "x",
      title: "X",
      raw: "Mystery",
    });
    expect(deck.cards[0].term).toBe("Mystery");
    expect(deck.cards[0].definition).toBe("definition coming soon");
  });
});
