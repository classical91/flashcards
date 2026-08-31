import { describe, expect, it } from "vitest";
import { DeckSection } from "../../data/deckBuilder";
import { MAX_SEARCH_RESULTS, searchLibrary } from "../search";

const library: DeckSection[] = [
  {
    id: "emotions",
    title: "Emotions",
    description: "",
    decks: [
      {
        id: "feelings",
        title: "Feelings",
        subtitle: "Everyday moods",
        cards: [
          { id: "serene", term: "Serene", definition: "calm and untroubled" },
          { id: "wistful", term: "Wistful", definition: "a gentle, calm longing for the past" },
        ],
      },
    ],
  },
  {
    id: "weather",
    title: "Weather",
    description: "",
    decks: [
      {
        id: "calm-seas",
        title: "Calm seas",
        subtitle: "",
        cards: [{ id: "doldrums", term: "Doldrums", definition: "a windless stretch of ocean" }],
      },
    ],
  },
];

const labels = (query: string) =>
  searchLibrary(library, query).results.map((result) =>
    result.kind === "deck" ? `deck:${result.deck.id}` : `card:${result.card.id}`,
  );

describe("searchLibrary", () => {
  it("returns nothing for an empty query", () => {
    expect(searchLibrary(library, "   ")).toEqual({ results: [], total: 0 });
  });

  it("finds a card by its term, which deck-only search could not", () => {
    expect(labels("wistful")).toEqual(["card:wistful"]);
  });

  it("finds a card by its definition", () => {
    expect(labels("windless")).toEqual(["card:doldrums"]);
  });

  it("still finds decks by title, subtitle and topic name", () => {
    expect(labels("everyday")).toEqual(["deck:feelings"]);
    expect(labels("weather")).toEqual(["deck:calm-seas"]);
  });

  it("puts deck matches above card matches, and terms above definitions", () => {
    expect(labels("calm")).toEqual(["deck:calm-seas", "card:serene", "card:wistful"]);
  });

  it("ranks a term that starts with the query above one that merely contains it", () => {
    const sections: DeckSection[] = [
      {
        id: "s",
        title: "S",
        description: "",
        decks: [
          {
            id: "d",
            title: "D",
            subtitle: "",
            cards: [
              { id: "unrest", term: "Unrest", definition: "x" },
              { id: "rest", term: "Rest", definition: "x" },
            ],
          },
        ],
      },
    ];
    expect(
      searchLibrary(sections, "rest").results.map((r) =>
        r.kind === "card" ? r.card.id : r.deck.id,
      ),
    ).toEqual(["rest", "unrest"]);
  });

  it("is case insensitive", () => {
    expect(labels("SERENE")).toEqual(["card:serene"]);
  });

  it("says which field a card matched on", () => {
    const [byTerm] = searchLibrary(library, "serene").results;
    expect(byTerm).toMatchObject({ kind: "card", matchedIn: "term" });

    const [byDefinition] = searchLibrary(library, "windless").results;
    expect(byDefinition).toMatchObject({ kind: "card", matchedIn: "definition" });
  });

  it("caps the results but still reports the full match count", () => {
    const many: DeckSection[] = [
      {
        id: "s",
        title: "S",
        description: "",
        decks: [
          {
            id: "d",
            title: "D",
            subtitle: "",
            cards: Array.from({ length: MAX_SEARCH_RESULTS + 10 }, (_, index) => ({
              id: `c${index}`,
              term: `match ${index}`,
              definition: "x",
            })),
          },
        ],
      },
    ];

    const { results, total } = searchLibrary(many, "match");
    expect(results).toHaveLength(MAX_SEARCH_RESULTS);
    expect(total).toBe(MAX_SEARCH_RESULTS + 10);
  });

  it("carries the deck and topic a card was found in", () => {
    const [result] = searchLibrary(library, "doldrums").results;
    expect(result).toMatchObject({
      kind: "card",
      deck: { id: "calm-seas" },
      section: { id: "weather" },
    });
  });
});
