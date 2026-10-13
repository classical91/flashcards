import { describe, expect, it } from "vitest";
import { DeckSection } from "../../data/deckBuilder";
import { parseSavedView } from "../savedView";

const sections = [
  { id: "topic", title: "Topic", decks: [{ id: "deck", title: "Deck", cards: [] }] },
] as unknown as DeckSection[];

const parse = (view: unknown) => parseSavedView(JSON.stringify(view), sections);

describe("parseSavedView", () => {
  it("starts on home when nothing was saved or it cannot be read", () => {
    expect(parseSavedView(null, sections)).toEqual({ kind: "home" });
    expect(parseSavedView("not json", sections)).toEqual({ kind: "home" });
    expect(parse({ kind: "nowhere" })).toEqual({ kind: "home" });
  });

  it("restores a deck, topic or the pinned page that still exists", () => {
    expect(parse({ kind: "study", deckId: "deck" })).toEqual({ kind: "study", deckId: "deck" });
    expect(parse({ kind: "section", sectionId: "topic" })).toEqual({
      kind: "section",
      sectionId: "topic",
    });
    expect(parse({ kind: "pinned" })).toEqual({ kind: "pinned" });
  });

  it("falls back to home for a deck or topic that is gone", () => {
    expect(parse({ kind: "study", deckId: "deleted" })).toEqual({ kind: "home" });
    expect(parse({ kind: "section", sectionId: "deleted" })).toEqual({ kind: "home" });
  });
});
