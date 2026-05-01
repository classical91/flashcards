import { DeckSection } from "./deckBuilder";
import { emotions1Deck } from "./emotions1";
import { emotions2Deck } from "./emotions2";
import { positiveAdjectivesDeck } from "./positiveAdjectives";

export const starterSections: DeckSection[] = [
  {
    id: "gpt",
    title: "GPT",
    description: "AI-generated starter decks.",
    decks: [positiveAdjectivesDeck],
  },
  {
    id: "wikipedia",
    title: "Wikipedia",
    description: "Reference-style decks adapted from encyclopedia topics.",
    decks: [emotions1Deck, emotions2Deck],
  },
  {
    id: "oxford-dictionaries",
    title: "Oxford Dictionaries",
    description: "A place for dictionary-based vocabulary decks you add yourself.",
    decks: [],
  },
];

export const defaultDeckId = positiveAdjectivesDeck.id;
