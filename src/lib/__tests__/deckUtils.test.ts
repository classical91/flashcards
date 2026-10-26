import { describe, expect, it } from "vitest";
import {
  applyStudyOrder,
  createDeckProgress,
  resetCardsProgress,
  resetDeckProgress,
  shuffleCards,
  sortDecks,
  sortDecksByLastViewed,
  sortSections,
  toggleStarredCard,
} from "../deckUtils";

const decks = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

const ids = (list: { id: string }[]) => list.map((deck) => deck.id);

describe("sortDecks", () => {
  const titled = [
    { id: "a", title: "napoleon Hill" },
    { id: "b", title: "Bob Proctor" },
    { id: "c", title: "Ernest Holmes" },
    { id: "d", title: "Deck 10" },
    { id: "e", title: "Deck 2" },
  ];

  it("keeps list order for oldest and reverses it for newest", () => {
    expect(ids(sortDecks(titled, "oldest", {}))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(sortDecks(titled, "newest", {}))).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("sorts by title ignoring case and comparing numbers by value", () => {
    expect(ids(sortDecks(titled, "title", {}))).toEqual(["b", "e", "d", "c", "a"]);
  });

  it("orders by last studied in studied mode", () => {
    expect(ids(sortDecks(titled, "studied", { c: 200, e: 100 }))).toEqual([
      "c",
      "e",
      "a",
      "b",
      "d",
    ]);
  });

  it("never mutates the deck list it was given", () => {
    const copy = [...titled];
    sortDecks(titled, "newest", {});
    sortDecks(titled, "title", {});
    expect(titled).toEqual(copy);
  });
});

describe("sortSections", () => {
  const topics = [
    { id: "gpt", title: "GPT" },
    { id: "wiki", title: "Wikipedia" },
    { id: "oxford", title: "oxford Dictionaries" },
    { id: "syn", title: "Synonyms" },
    { id: "a", title: "Topic 10" },
    { id: "b", title: "Topic 2" },
  ];

  it("keeps library order by default", () => {
    expect(ids(sortSections(topics, "default"))).toEqual([
      "gpt",
      "wiki",
      "oxford",
      "syn",
      "a",
      "b",
    ]);
  });

  it("sorts A–Z ignoring case and comparing numbers by value", () => {
    expect(ids(sortSections(topics, "title"))).toEqual(["gpt", "oxford", "syn", "b", "a", "wiki"]);
  });

  it("sorts Z–A as the reverse", () => {
    expect(ids(sortSections(topics, "title-desc"))).toEqual([
      "wiki",
      "a",
      "b",
      "syn",
      "oxford",
      "gpt",
    ]);
  });

  it("keeps list order for topics with the same name in either direction", () => {
    const twins = [
      { id: "x", title: "Art" },
      { id: "y", title: "art" },
    ];
    expect(ids(sortSections(twins, "title"))).toEqual(["x", "y"]);
    expect(ids(sortSections(twins, "title-desc"))).toEqual(["x", "y"]);
  });

  it("never mutates the topic list it was given", () => {
    const copy = [...topics];
    sortSections(topics, "default");
    sortSections(topics, "title");
    sortSections(topics, "title-desc");
    expect(topics).toEqual(copy);
  });
});

describe("sortDecksByLastViewed", () => {
  it("keeps the original order when nothing has been viewed", () => {
    expect(ids(sortDecksByLastViewed(decks, {}))).toEqual(["a", "b", "c", "d"]);
  });

  it("moves the most recently viewed deck to the top", () => {
    expect(ids(sortDecksByLastViewed(decks, { c: 100 }))).toEqual(["c", "a", "b", "d"]);
  });

  it("orders viewed decks most recent first and keeps unviewed decks after them", () => {
    const lastViewed = { b: 300, d: 100, a: 200 };
    expect(ids(sortDecksByLastViewed(decks, lastViewed))).toEqual(["b", "a", "d", "c"]);
  });

  it("re-opening a deck floats it above the previous top deck", () => {
    const lastViewed = { a: 100, b: 200 };
    expect(ids(sortDecksByLastViewed(decks, lastViewed))).toEqual(["b", "a", "c", "d"]);
    const afterReopeningA = { ...lastViewed, a: 300 };
    expect(ids(sortDecksByLastViewed(decks, afterReopeningA))).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to the original order for identical timestamps", () => {
    expect(ids(sortDecksByLastViewed(decks, { c: 100, a: 100 }))).toEqual(["a", "c", "b", "d"]);
  });

  it("ignores timestamps for decks that are not in the list", () => {
    expect(ids(sortDecksByLastViewed(decks, { gone: 999, d: 5 }))).toEqual(["d", "a", "b", "c"]);
  });

  it("does not mutate the deck list it was given", () => {
    const original = [...decks];
    sortDecksByLastViewed(decks, { d: 1 });
    expect(decks).toEqual(original);
  });
});

describe("applyStudyOrder", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns the deck's own order when no session order is set", () => {
    expect(applyStudyOrder(cards, null)).toBe(cards);
  });

  it("reorders the cards to match the session order", () => {
    expect(ids(applyStudyOrder(cards, ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("puts cards added since the shuffle at the end, in the deck's order", () => {
    const withNewCards = [...cards, { id: "d" }, { id: "e" }];
    expect(ids(applyStudyOrder(withNewCards, ["c", "a", "b"]))).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("ignores ids for cards that have since been deleted", () => {
    expect(ids(applyStudyOrder(cards, ["gone", "c", "b", "a"]))).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the deck's card list", () => {
    const original = [...cards];
    applyStudyOrder(cards, ["c", "b", "a"]);
    expect(cards).toEqual(original);
  });

  it("shuffling produces an order without changing the deck itself", () => {
    const deckCards = [...cards];
    const order = shuffleCards(deckCards).map((card) => card.id);
    expect(order.slice().sort()).toEqual(["a", "b", "c"]);
    expect(deckCards).toEqual(cards);
  });
});

describe("starred cards", () => {
  const starDeck = {
    id: "d1",
    title: "d1",
    subtitle: "",
    cards: [
      { id: "a", term: "a", definition: "a" },
      { id: "b", term: "b", definition: "b" },
    ],
  };

  it("stars and unstars a card, stamping each change", () => {
    const starred = toggleStarredCard(createDeckProgress(starDeck), "a", 100);
    expect(starred.starredIds).toEqual(["a"]);
    expect(starred.starredUpdatedAt).toEqual({ a: 100 });

    const unstarred = toggleStarredCard(starred, "a", 200);
    expect(unstarred.starredIds).toEqual([]);
    expect(unstarred.starredUpdatedAt).toEqual({ a: 200 });
  });

  it("keeps stars through a progress reset", () => {
    const starred = toggleStarredCard(createDeckProgress(starDeck), "b", 100);
    const reset = resetDeckProgress(starDeck, 500, starred);
    expect(reset.starredIds).toEqual(["b"]);
    expect(reset.starredUpdatedAt).toEqual({ b: 100 });
    expect(reset.resetAt).toBe(500);
  });
});

describe("resetCardsProgress", () => {
  it("clears only the given cards' marks and schedules", () => {
    const review = { due: 900, interval: 3, ease: 2.5, reps: 2, lapses: 0, lastReviewedAt: 100 };
    const progress = {
      currentCardId: "a",
      knownIds: ["a", "b"],
      isFlipped: false,
      studyMode: "all" as const,
      reviews: { a: review, b: review },
    };

    const reset = resetCardsProgress(progress, ["a"], 500);
    expect(reset.knownIds).toEqual(["b"]);
    expect(Object.keys(reset.reviews ?? {})).toEqual(["b"]);
    expect(reset.knownUpdatedAt).toEqual({ a: 500 });
    expect(reset.cardResetAt).toEqual({ a: 500 });
  });
});
