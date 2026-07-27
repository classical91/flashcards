import { DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";

export type DailyCardRef = {
  dateKey: string;
  deckId: string;
  cardId: string;
};

/**
 * Local calendar day, not UTC, so the card turns over at the user's own
 * midnight rather than at some hour in the middle of their day.
 */
export const toDateKey = (date: Date) => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/** FNV-1a — a small, dependency-free string hash with a good spread. */
const hashString = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Picks the card to focus on for `dateKey`. The choice is derived from the date
 * rather than Math.random, so the same day always resolves to the same card
 * even before anything has been saved.
 *
 * Cards already marked known are skipped while any unknown card remains —
 * a "study this today" card you've already learned isn't worth the slot.
 */
export const pickDailyCard = (
  sections: DeckSection[],
  deckProgress: Record<string, DeckProgress>,
  dateKey: string,
): DailyCardRef | null => {
  const everyCard: { deckId: string; cardId: string }[] = [];
  const unlearned: { deckId: string; cardId: string }[] = [];

  sections.forEach((section) => {
    section.decks.forEach((deck) => {
      const knownIds = new Set(deckProgress[deck.id]?.knownIds ?? []);
      deck.cards.forEach((card) => {
        const entry = { deckId: deck.id, cardId: card.id };
        everyCard.push(entry);
        if (!knownIds.has(card.id)) unlearned.push(entry);
      });
    });
  });

  const pool = unlearned.length > 0 ? unlearned : everyCard;
  if (pool.length === 0) return null;

  return { dateKey, ...pool[hashString(dateKey) % pool.length] };
};

export const parseDailyCard = (value: unknown): DailyCardRef | null => {
  if (!value || typeof value !== "object") return null;
  const { dateKey, deckId, cardId } = value as Record<string, unknown>;
  if (typeof dateKey !== "string" || typeof deckId !== "string" || typeof cardId !== "string") {
    return null;
  }
  return { dateKey, deckId, cardId };
};
