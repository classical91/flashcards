import { describe, expect, it } from "vitest";
import { sortDecksByLastViewed } from "../deckUtils";

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
