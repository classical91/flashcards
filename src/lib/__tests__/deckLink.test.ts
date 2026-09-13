import { describe, expect, it } from "vitest";
import { buildDeckUrl, getDeckLinkFromSearch } from "../deckLink";

describe("getDeckLinkFromSearch", () => {
  it("reads the deck a link names", () => {
    expect(getDeckLinkFromSearch("?deck=emotions-1")).toEqual({
      deckId: "emotions-1",
      cardId: null,
    });
  });

  it("reads the card a link lands on", () => {
    expect(getDeckLinkFromSearch("?deck=emotions-1&card=wistful")).toEqual({
      deckId: "emotions-1",
      cardId: "wistful",
    });
  });

  it("takes the query with or without its leading question mark", () => {
    expect(getDeckLinkFromSearch("deck=emotions-1")).toEqual({
      deckId: "emotions-1",
      cardId: null,
    });
  });

  it("decodes an id that needed encoding", () => {
    expect(getDeckLinkFromSearch("?deck=side%20quests")).toEqual({
      deckId: "side quests",
      cardId: null,
    });
  });

  it("is not a deck link without a deck", () => {
    // A blank deck can only ever miss, so it is no link rather than a link to
    // nothing — the reader gets the library, not a "deck not found".
    expect(getDeckLinkFromSearch("")).toBeNull();
    expect(getDeckLinkFromSearch("?card=wistful")).toBeNull();
    expect(getDeckLinkFromSearch("?deck=")).toBeNull();
    expect(getDeckLinkFromSearch("?deck=%20%20")).toBeNull();
  });

  it("drops a card id that is only whitespace", () => {
    expect(getDeckLinkFromSearch("?deck=emotions-1&card=%20")).toEqual({
      deckId: "emotions-1",
      cardId: null,
    });
  });
});

describe("buildDeckUrl", () => {
  it("round-trips through the reader", () => {
    const url = buildDeckUrl("https://cards.example", "emotions-1", "wistful");
    expect(url).toBe("https://cards.example/?deck=emotions-1&card=wistful");
    expect(getDeckLinkFromSearch(new URL(url).search)).toEqual({
      deckId: "emotions-1",
      cardId: "wistful",
    });
  });

  it("leaves the card out when there is not one", () => {
    expect(buildDeckUrl("https://cards.example", "emotions-1")).toBe(
      "https://cards.example/?deck=emotions-1",
    );
    expect(buildDeckUrl("https://cards.example", "emotions-1", null)).toBe(
      "https://cards.example/?deck=emotions-1",
    );
  });

  it("encodes an id that needs it", () => {
    expect(buildDeckUrl("https://cards.example", "side quests")).toBe(
      "https://cards.example/?deck=side+quests",
    );
  });
});
