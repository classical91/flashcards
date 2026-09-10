/**
 * Card of the Day, server side.
 *
 * This is a deliberate, byte-for-byte mirror of `src/lib/dailyCard.ts`. The app
 * owns the behaviour; this file exists only because `server.mjs` runs untranspiled
 * and cannot import the TypeScript module the app builds from.
 *
 * Two copies of one rule is a fork waiting to happen, so
 * `src/lib/__tests__/dailyCard.test.ts` runs BOTH implementations over the same
 * fixtures and fails if they ever disagree. Change one, change the other, or CI
 * stops you.
 */

/**
 * Local calendar day, not UTC, so the card turns over at the user's own
 * midnight rather than at some hour in the middle of their day.
 */
export const toDateKey = (date) => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/** FNV-1a — a small, dependency-free string hash with a good spread. */
const hashString = (value) => {
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
export const pickDailyCard = (sections, deckProgress, dateKey) => {
  const everyCard = [];
  const unlearned = [];

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

/** A date key the caller supplied, or null if it is not a real YYYY-MM-DD. */
export const parseDateKey = (value) => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejects 2026-02-31 and friends, which Date happily rolls forward.
  if (date.getFullYear() !== Number(year)) return null;
  if (date.getMonth() !== Number(month) - 1) return null;
  if (date.getDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
};

/**
 * The whole point of this endpoint: resolve the day's card and hand back only
 * that card. A caller asking "what should I study today" has no business
 * receiving the library, so nothing here reaches into the snapshot beyond the
 * one deck and the one card the pick landed on.
 */
export const resolveDailyCard = (snapshot, dateKey) => {
  const sections = Array.isArray(snapshot?.librarySections) ? snapshot.librarySections : [];
  const deckProgress =
    snapshot?.deckProgress && typeof snapshot.deckProgress === "object"
      ? snapshot.deckProgress
      : {};

  const reference = pickDailyCard(sections, deckProgress, dateKey);
  if (!reference) return null;

  for (const section of sections) {
    for (const deck of section.decks ?? []) {
      if (deck.id !== reference.deckId) continue;
      const card = (deck.cards ?? []).find((entry) => entry.id === reference.cardId);
      if (!card) return null;
      return {
        dateKey,
        card: { id: card.id, term: card.term ?? "", definition: card.definition ?? "" },
        deck: { id: deck.id, title: deck.title ?? "", subtitle: deck.subtitle ?? "" },
        section: { id: section.id, title: section.title ?? "" },
      };
    }
  }

  return null;
};
