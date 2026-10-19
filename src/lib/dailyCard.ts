import { DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";

export type DailyCardRef = {
  dateKey: string;
  deckId: string;
  cardId: string;
  /**
   * True once the cloud has said this is the day's card. The server keeps one
   * pick per library per date (see server-daily-card.mjs), so a confirmed pick
   * is the card every device and Main Hub are showing. Without it the pick is
   * this device's own — made offline, before the cloud answered, or saved by a
   * version of the app that predates the canonical pick — and the cloud's
   * answer replaces it as soon as one arrives.
   */
  confirmed?: boolean;
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
  const { dateKey, deckId, cardId, confirmed } = value as Record<string, unknown>;
  if (typeof dateKey !== "string" || typeof deckId !== "string" || typeof cardId !== "string") {
    return null;
  }
  return confirmed === true ? { dateKey, deckId, cardId, confirmed } : { dateKey, deckId, cardId };
};

/**
 * Reads the daily-card endpoint's answer as a confirmed reference for
 * `dateKey`, or null when it has no card for that day (an empty library, no
 * cloud library, or an answer for some other date).
 */
export const parseCanonicalDailyCard = (payload: unknown, dateKey: string): DailyCardRef | null => {
  if (!payload || typeof payload !== "object") return null;
  const { dateKey: answeredFor, card, deck } = payload as Record<string, unknown>;
  if (answeredFor !== dateKey) return null;
  const cardId = (card as { id?: unknown } | null | undefined)?.id;
  const deckId = (deck as { id?: unknown } | null | undefined)?.id;
  if (typeof cardId !== "string" || typeof deckId !== "string") return null;
  return { dateKey, deckId, cardId, confirmed: true };
};

/** Whether the reference still points at a card in this library. */
export const dailyCardExists = (sections: DeckSection[], ref: DailyCardRef | null) =>
  !!ref &&
  sections.some((section) =>
    section.decks.some(
      (deck) => deck.id === ref.deckId && deck.cards.some((card) => card.id === ref.cardId),
    ),
  );

/** True when the cloud has confirmed this reference as `dateKey`'s card. */
export const isConfirmedFor = (ref: DailyCardRef | null, dateKey: string) =>
  !!ref && ref.dateKey === dateKey && ref.confirmed === true;

/**
 * Which pick this device should hold once the cloud has answered.
 *
 * The cloud's wins whenever it names a card this device has. That includes a
 * pick saved here earlier — offline, or by an older version of the app that
 * pinned its own card in this browser only: those were only ever this device's
 * guess, and the cloud's is the one Main Hub and every other device show.
 *
 * A cloud answer naming a card this device does not have yet (a merge still
 * landing) or no longer has (deleted here, not yet saved) is not adopted; the
 * local pick stands until the next sync, when the cloud is asked again.
 */
export const reconcileDailyCard = (
  local: DailyCardRef | null,
  canonical: DailyCardRef | null,
  sections: DeckSection[],
): DailyCardRef | null => (canonical && dailyCardExists(sections, canonical) ? canonical : local);
