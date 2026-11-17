/**
 * Recently viewed cards, server side.
 *
 * Reads the synced library snapshot and answers "which card was I last on, in
 * each deck I opened most recently?" — the same thing the home page's Recently
 * viewed list shows. Main Hub's System Logs page polls this to show flashcard
 * activity alongside the other apps.
 *
 * Only the deck, topic and card are returned, never the library itself.
 */

export const DEFAULT_RECENT_LIMIT = 5;
export const MAX_RECENT_LIMIT = 20;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses ?limit=; anything missing or invalid falls back to the default. */
export const parseRecentLimit = (value) => {
  if (value === null || value === undefined || value === "") return DEFAULT_RECENT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RECENT_LIMIT;
  return Math.min(parsed, MAX_RECENT_LIMIT);
};

/**
 * v2 snapshots carry timestamped `preferences.recentDecks`; older ones only a
 * flat `recentDeckIds` list, which has no times.
 */
const readRecentEntries = (snapshot) => {
  const fromPreferences = isRecord(snapshot.preferences) ? snapshot.preferences.recentDecks : null;
  if (Array.isArray(fromPreferences)) {
    return fromPreferences
      .filter((entry) => isRecord(entry) && typeof entry.id === "string")
      .map((entry) => ({
        id: entry.id,
        viewedAt:
          typeof entry.viewedAt === "number" && Number.isFinite(entry.viewedAt) && entry.viewedAt > 0
            ? entry.viewedAt
            : null,
      }));
  }
  if (Array.isArray(snapshot.recentDeckIds)) {
    return snapshot.recentDeckIds
      .filter((id) => typeof id === "string")
      .map((id) => ({ id, viewedAt: null }));
  }
  return [];
};

/**
 * @returns {Array<{ viewedAt: string | null, card: {id, term, definition},
 *   deck: {id, title, subtitle}, section: {id, title} }>}
 *   most recent first. Decks that no longer exist or have no cards are skipped.
 */
export const resolveRecentCards = (snapshot, limit = DEFAULT_RECENT_LIMIT) => {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.librarySections)) return [];
  const progress = isRecord(snapshot.deckProgress) ? snapshot.deckProgress : {};

  const decksById = new Map();
  for (const section of snapshot.librarySections) {
    if (!isRecord(section) || !Array.isArray(section.decks)) continue;
    for (const deck of section.decks) {
      if (isRecord(deck) && typeof deck.id === "string") decksById.set(deck.id, { deck, section });
    }
  }

  const seen = new Set();
  const items = [];
  for (const entry of readRecentEntries(snapshot)) {
    if (items.length >= limit) break;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const found = decksById.get(entry.id);
    if (!found || !Array.isArray(found.deck.cards) || found.deck.cards.length === 0) continue;
    const { deck, section } = found;

    const currentCardId = isRecord(progress[deck.id]) ? progress[deck.id].currentCardId : undefined;
    const card = deck.cards.find((c) => isRecord(c) && c.id === currentCardId) ?? deck.cards[0];
    if (!isRecord(card)) continue;

    items.push({
      viewedAt: entry.viewedAt === null ? null : new Date(entry.viewedAt).toISOString(),
      card: {
        id: String(card.id ?? ""),
        term: String(card.term ?? ""),
        definition: String(card.definition ?? ""),
      },
      deck: {
        id: deck.id,
        title: String(deck.title ?? ""),
        subtitle: String(deck.subtitle ?? ""),
      },
      section: { id: String(section.id ?? ""), title: String(section.title ?? "") },
    });
  }
  return items;
};
