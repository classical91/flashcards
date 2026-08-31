import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import { DeckLastViewed } from "./types";

export const shuffleCards = <T>(cards: T[]): T[] => {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

/**
 * Reorders a deck's cards for the current study session.
 *
 * Shuffling used to rewrite `deck.cards` in the saved library, which made a
 * throwaway reordering permanent and pushed it to every other device. The
 * order now lives only in session state and is applied here instead. Cards
 * added since the shuffle aren't in `order`, so they keep the deck's own
 * order at the end rather than jumping to the front.
 */
export const applyStudyOrder = <T extends { id: string }>(cards: T[], order: string[] | null) => {
  if (!order) return cards;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...cards].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
};

export const cloneSections = (sections: DeckSection[]) =>
  sections.map((section) => ({
    ...section,
    decks: section.decks.map((deck) => ({
      ...deck,
      cards: deck.cards.map((card) => ({ ...card })),
    })),
  }));

export const flattenDecks = (sections: DeckSection[]) => sections.flatMap((s) => s.decks);

/**
 * Orders decks most-recently-opened first so a deck you just studied jumps to
 * the top of its topic. Decks that have never been opened keep their original
 * order and stay below the ones that have.
 */
export const sortDecksByLastViewed = <T extends { id: string }>(
  decks: T[],
  lastViewed: DeckLastViewed,
): T[] =>
  decks
    .map((deck, index) => ({ deck, index, viewedAt: lastViewed[deck.id] }))
    .sort((a, b) => {
      if (a.viewedAt === undefined && b.viewedAt === undefined) return a.index - b.index;
      if (a.viewedAt === undefined) return 1;
      if (b.viewedAt === undefined) return -1;
      if (a.viewedAt === b.viewedAt) return a.index - b.index;
      return b.viewedAt - a.viewedAt;
    })
    .map((entry) => entry.deck);

export const findDeckById = (sections: DeckSection[], deckId: string) =>
  flattenDecks(sections).find((deck) => deck.id === deckId) ?? null;

export const findSectionForDeck = (sections: DeckSection[], deckId: string) =>
  sections.find((section) => section.decks.some((deck) => deck.id === deckId)) ??
  sections[0] ??
  null;

export const createDeckProgress = (deck: Deck): DeckProgress => ({
  currentCardId: deck.cards[0]?.id ?? "",
  knownIds: [],
  isFlipped: false,
  studyMode: "all",
  reviews: {},
});

export const buildProgressState = (sections: DeckSection[]) =>
  Object.fromEntries(
    flattenDecks(sections).map((deck) => [deck.id, createDeckProgress(deck)]),
  ) as Record<string, DeckProgress>;

export const updateDeckInSections = (
  sections: DeckSection[],
  deckId: string,
  updater: (deck: Deck) => Deck,
) =>
  sections.map((section) => ({
    ...section,
    decks: section.decks.map((deck) => (deck.id === deckId ? updater(deck) : deck)),
  }));

/**
 * Stamps an entity as edited now. Every library mutation goes through one of
 * these so the cloud merge can order two devices' edits to the same id; an
 * unstamped entity is treated as older than anything stamped.
 */
export const touchCard = (card: Flashcard, now = Date.now()): Flashcard => ({
  ...card,
  updatedAt: now,
});

export const touchDeck = (deck: Deck, now = Date.now()): Deck => ({ ...deck, updatedAt: now });

export const touchSection = (section: DeckSection, now = Date.now()): DeckSection => ({
  ...section,
  updatedAt: now,
});

export const touchProgress = (progress: DeckProgress, now = Date.now()): DeckProgress => ({
  ...progress,
  updatedAt: now,
});
