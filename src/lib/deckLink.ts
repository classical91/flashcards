/**
 * Deep links to one deck.
 *
 * The hub's Card of the Day names a deck and a card, and "Open Flashcards"
 * should land on that deck rather than on the library you then have to find it
 * in. A query on the root path is enough for that: `/` is the only page this
 * SPA serves, so `?deck=<id>` needs no server rewrite the way `/d/<shareId>`
 * does, and a link that predates the app reading it simply boots the library.
 *
 * Ids travel as they are stored — a deck id is a slug (see `createUniqueId`) —
 * and are encoded anyway, because what an id may contain is `deckBuilder`'s
 * decision to change, not this file's to assume.
 */

export const DECK_QUERY_PARAM = "deck";
export const CARD_QUERY_PARAM = "card";

/**
 * How long a deck link waits for its deck to arrive from the cloud before it
 * gives up and says so. Long enough for a slow first sync, short enough that a
 * link to a deck this library does not have stops being a silent no-op.
 */
export const DECK_LINK_WAIT_MS = 15000;

export type DeckLink = {
  deckId: string;
  /** The card to land on, when the link named one. */
  cardId: string | null;
};

/**
 * Reads a deck link out of a query string, or null when there is not one.
 *
 * A blank or whitespace-only `deck` is "no link" rather than a link to a deck
 * with no id: it can only ever miss, and missing is reported to the reader.
 */
export const getDeckLinkFromSearch = (search: string): DeckLink | null => {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  const deckId = (params.get(DECK_QUERY_PARAM) ?? "").trim();
  if (!deckId) return null;

  const cardId = (params.get(CARD_QUERY_PARAM) ?? "").trim();
  return { deckId, cardId: cardId || null };
};

/** The link another app puts behind "open this deck". */
export const buildDeckUrl = (origin: string, deckId: string, cardId?: string | null) => {
  const query = new URLSearchParams({ [DECK_QUERY_PARAM]: deckId });
  if (cardId) query.set(CARD_QUERY_PARAM, cardId);
  return `${origin}/?${query.toString()}`;
};
