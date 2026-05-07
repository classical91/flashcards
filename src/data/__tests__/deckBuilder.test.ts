import { describe, it, expect } from "vitest";
import { parsePastedFlashcards, createUniqueId } from "../deckBuilder";

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
});
