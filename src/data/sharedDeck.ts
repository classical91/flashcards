import { Deck } from "./deckBuilder";

export type SharedDeckSection = {
  id: string;
  title: string;
  description: string;
};

export type SharedDeckSnapshot = {
  version: 1;
  sharedAt: string;
  deck: Deck;
  section: SharedDeckSection;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFlashcard = (value: unknown) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.term === "string" &&
  typeof value.definition === "string";

const isDeck = (value: unknown): value is Deck =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  Array.isArray(value.cards) &&
  value.cards.every(isFlashcard);

const isSharedDeckSection = (value: unknown): value is SharedDeckSection =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.description === "string";

export const parseSharedDeckSnapshot = (
  value: unknown,
): SharedDeckSnapshot | null => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.sharedAt !== "string" ||
    !isDeck(value.deck) ||
    !isSharedDeckSection(value.section)
  ) {
    return null;
  }

  return {
    version: 1,
    sharedAt: value.sharedAt,
    deck: value.deck,
    section: value.section,
  };
};
