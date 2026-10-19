/**
 * Card of the Day, server side.
 *
 * `toDateKey` and `pickDailyCard` are a deliberate, byte-for-byte mirror of
 * `src/lib/dailyCard.ts`. The app owns that rule; it is restated here only
 * because `server.mjs` runs untranspiled and cannot import the TypeScript module
 * the app builds from.
 *
 * What is the server's alone is keeping the pick: the first card chosen for a
 * library and a date is stored and served for the rest of that day, so every
 * device and Main Hub's Daily Dashboard see one card — see
 * resolveCanonicalDailyCard at the bottom.
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
 * Describes one stored reference against the live snapshot: the card, its deck
 * and its topic, or null when the card no longer exists. Resolving by id each
 * time is what keeps a renamed deck's title current while the pick itself
 * stays put.
 *
 * A caller asking "what should I study today" has no business receiving the
 * library, so nothing here reaches into the snapshot beyond the one deck and
 * the one card the reference names.
 */
export const describeDailyCard = (snapshot, reference, dateKey) => {
  if (!reference) return null;
  const sections = Array.isArray(snapshot?.librarySections) ? snapshot.librarySections : [];

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

/** What pickDailyCard would choose for `dateKey` from this snapshot right now. */
export const pickFromSnapshot = (snapshot, dateKey) => {
  const sections = Array.isArray(snapshot?.librarySections) ? snapshot.librarySections : [];
  const deckProgress =
    snapshot?.deckProgress && typeof snapshot.deckProgress === "object"
      ? snapshot.deckProgress
      : {};
  return pickDailyCard(sections, deckProgress, dateKey);
};

/**
 * Resolves the day's card fresh from the snapshot, with no memory of an earlier
 * pick. The server only answers this way for days it does not keep a canonical
 * pick for — see isCanonicalDateKey.
 */
export const resolveDailyCard = (snapshot, dateKey) =>
  describeDailyCard(snapshot, pickFromSnapshot(snapshot, dateKey), dateKey);

const dayNumber = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

/**
 * How many days either side of the server's UTC date still get a canonical,
 * stored pick. Two covers every time zone on Earth (UTC-12 to UTC+14) with room
 * to spare, so any caller asking about its own "today" lands inside it.
 */
export const CANONICAL_WINDOW_DAYS = 2;

/**
 * Whether `dateKey` is close enough to now to be someone's today. Only those
 * days get a stored pick: it keeps the table to a handful of rows per library,
 * however many dates a key holder cares to ask about.
 */
export const isCanonicalDateKey = (dateKey, now = new Date()) => {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000;
  return Math.abs(dayNumber(dateKey) - today) <= CANONICAL_WINDOW_DAYS;
};

/** The oldest date key still inside the window, for pruning older picks. */
export const oldestCanonicalDateKey = (now = new Date()) => {
  const oldest = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - CANONICAL_WINDOW_DAYS),
  );
  return oldest.toISOString().slice(0, 10);
};

/**
 * The canonical Card of the Day: the first pick made for this library and date,
 * kept for the rest of that day.
 *
 * `store` is the server's selection storage — `get(dateKey)` and
 * `claim(dateKey, expected, next)`, where claim is a compare-and-swap that
 * writes `next` only while the stored value still equals `expected` (null for
 * "nothing stored yet") and always returns whatever is stored afterwards. That
 * is what lets two devices asking at the same moment end up on one card: the
 * loser of the race reads back the winner's pick instead of its own.
 *
 * A stored pick is replaced only when its card no longer exists, and the
 * replacement comes from the same pickDailyCard rule. Reading never touches the
 * library or its progress; the only thing written is the reference itself.
 */
export const resolveCanonicalDailyCard = async (snapshot, dateKey, store) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await store.get(dateKey);
    const current = describeDailyCard(snapshot, stored, dateKey);
    if (current) return current;

    const next = pickFromSnapshot(snapshot, dateKey);
    // An empty library has nothing to pin. A stale reference stays where it is
    // and is replaced the first time there is a card to replace it with.
    if (!next) return null;

    const winner = await store.claim(dateKey, stored ?? null, {
      deckId: next.deckId,
      cardId: next.cardId,
    });
    const described = describeDailyCard(snapshot, winner, dateKey);
    if (described) return described;
    // The winner was written against a different version of the library and
    // names a card this one does not have. Go round again against what is
    // stored now.
  }

  // Never reached in practice. Answering with today's fresh pick beats
  // answering with nothing, and it is still a card that exists.
  return resolveDailyCard(snapshot, dateKey);
};
