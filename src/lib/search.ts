import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";

export type SearchResult =
  | { kind: "deck"; section: DeckSection; deck: Deck }
  | {
      kind: "card";
      section: DeckSection;
      deck: Deck;
      card: Flashcard;
      matchedIn: "term" | "definition";
    };

/**
 * Enough to scroll through, few enough that a one-letter query in a library of
 * thousands of cards doesn't build a huge list nobody will read.
 */
export const MAX_SEARCH_RESULTS = 60;

// Lower sorts first: whole decks before individual cards, and a match at the
// start of a name before one buried in the middle of a definition.
const DECK_TITLE_PREFIX = 0;
const DECK_TITLE_MATCH = 1;
const DECK_CONTEXT_MATCH = 2;
const CARD_TERM_PREFIX = 3;
const CARD_TERM_MATCH = 4;
const CARD_DEFINITION_MATCH = 5;

const scoreDeck = (deck: Deck, section: DeckSection, query: string) => {
  const title = deck.title.toLowerCase();
  if (title.startsWith(query)) return DECK_TITLE_PREFIX;
  if (title.includes(query)) return DECK_TITLE_MATCH;
  if ((deck.subtitle ?? "").toLowerCase().includes(query)) return DECK_CONTEXT_MATCH;
  if (section.title.toLowerCase().includes(query)) return DECK_CONTEXT_MATCH;
  return null;
};

const scoreCard = (card: Flashcard, query: string) => {
  const term = card.term.toLowerCase();
  if (term.startsWith(query)) return CARD_TERM_PREFIX;
  if (term.includes(query)) return CARD_TERM_MATCH;
  if (card.definition.toLowerCase().includes(query)) return CARD_DEFINITION_MATCH;
  return null;
};

/**
 * Searches deck names and the cards themselves.
 *
 * Home search used to look only at deck titles, subtitles and topic names,
 * which is no help when you remember a word but not which deck you filed it
 * in. Card hits carry their card so the caller can open the deck at it.
 *
 * `total` counts every match, not just the ones returned, so the caller can
 * say how many were left out.
 */
export const searchLibrary = (sections: DeckSection[], rawQuery: string) => {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return { results: [] as SearchResult[], total: 0 };

  const scored: { score: number; result: SearchResult }[] = [];

  sections.forEach((section) => {
    section.decks.forEach((deck) => {
      const deckScore = scoreDeck(deck, section, query);
      if (deckScore !== null) {
        scored.push({ score: deckScore, result: { kind: "deck", section, deck } });
      }

      deck.cards.forEach((card) => {
        const cardScore = scoreCard(card, query);
        if (cardScore === null) return;
        scored.push({
          score: cardScore,
          result: {
            kind: "card",
            section,
            deck,
            card,
            matchedIn: cardScore === CARD_DEFINITION_MATCH ? "definition" : "term",
          },
        });
      });
    });
  });

  // Sort is stable, so equal scores keep library order.
  const results = scored
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_SEARCH_RESULTS)
    .map((entry) => entry.result);

  return { results, total: scored.length };
};
