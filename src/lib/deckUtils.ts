import { Deck, DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";

export const shuffleCards = (cards: { id: string; term: string; definition: string }[]) => {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

export const cloneSections = (sections: DeckSection[]) =>
  sections.map((section) => ({
    ...section,
    decks: section.decks.map((deck) => ({
      ...deck,
      cards: deck.cards.map((card) => ({ ...card })),
    })),
  }));

export const mergeDeck = (cloudDeck: Deck, localDeck: Deck): Deck => {
  const cloudCardIds = new Set(cloudDeck.cards.map((card) => card.id));
  return {
    ...cloudDeck,
    cards: [
      ...cloudDeck.cards.map((card) => ({ ...card })),
      ...localDeck.cards
        .filter((card) => !cloudCardIds.has(card.id))
        .map((card) => ({ ...card })),
    ],
  };
};

export const mergeSections = (localSections: DeckSection[], cloudSections: DeckSection[]) => {
  const localSectionsById = new Map(localSections.map((s) => [s.id, s]));
  const cloudSectionIds = new Set(cloudSections.map((s) => s.id));
  const mergedSections = cloudSections.map((cloudSection) => {
    const localSection = localSectionsById.get(cloudSection.id);
    if (!localSection) {
      return {
        ...cloudSection,
        decks: cloudSection.decks.map((deck) => ({
          ...deck,
          cards: deck.cards.map((card) => ({ ...card })),
        })),
      };
    }
    const localDecksById = new Map(localSection.decks.map((deck) => [deck.id, deck]));
    const cloudDeckIds = new Set(cloudSection.decks.map((deck) => deck.id));
    return {
      ...cloudSection,
      decks: [
        ...cloudSection.decks.map((cloudDeck) => {
          const localDeck = localDecksById.get(cloudDeck.id);
          return localDeck ? mergeDeck(cloudDeck, localDeck) : { ...cloudDeck };
        }),
        ...localSection.decks
          .filter((deck) => !cloudDeckIds.has(deck.id))
          .map((deck) => ({ ...deck, cards: deck.cards.map((card) => ({ ...card })) })),
      ],
    };
  });
  return [
    ...mergedSections,
    ...localSections
      .filter((section) => !cloudSectionIds.has(section.id))
      .map((section) => ({
        ...section,
        decks: section.decks.map((deck) => ({
          ...deck,
          cards: deck.cards.map((card) => ({ ...card })),
        })),
      })),
  ];
};

export const flattenDecks = (sections: DeckSection[]) => sections.flatMap((s) => s.decks);

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

export const mergeProgressState = (
  localProgress: Record<string, DeckProgress>,
  cloudProgress: Record<string, DeckProgress>,
  sections: DeckSection[],
) => {
  const mergedProgress: Record<string, DeckProgress> = {};
  flattenDecks(sections).forEach((deck) => {
    const cloudDeckProgress = cloudProgress[deck.id];
    const localDeckProgress = localProgress[deck.id];
    const baseProgress = cloudDeckProgress ?? localDeckProgress ?? createDeckProgress(deck);
    mergedProgress[deck.id] = {
      ...baseProgress,
      knownIds: Array.from(
        new Set([
          ...(cloudDeckProgress?.knownIds ?? []),
          ...(localDeckProgress?.knownIds ?? []),
        ]),
      ),
    };
  });
  return mergedProgress;
};
