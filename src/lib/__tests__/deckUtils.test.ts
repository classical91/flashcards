import { describe, expect, it } from "vitest";
import { applyStudyOrder, shuffleCards, sortDecksByLastViewed } from "../deckUtils";

const decks = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

const ids = (list: { id: string }[]) => list.map((deck) => deck.id);

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
