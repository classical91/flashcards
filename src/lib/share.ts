import { Deck, DeckSection, createUniqueId, withCardIds } from "../data/deckBuilder";
import { SharedDeckSnapshot, parseSharedDeckSnapshot } from "../data/sharedDeck";
import { shareIdPattern } from "./constants";
import { getFetchErrorMessage } from "./sync";

/**
 * Share links are plain paths (`/d/<shareId>`) rather than a query string so
 * they read like a normal URL when pasted around. Both the production server
 * (`rewrites: ** -> /index.html`) and the Vite dev server fall back to
 * index.html for unknown paths, so the SPA boots and `Root`/`App` read the id
 * back out of `location.pathname`.
 */
export const SHARE_PATH_PREFIX = "/d/";

export const isShareIdValid = (value: string) => shareIdPattern.test(value);

/**
 * Reads the share id out of a pathname, or null when the path is not a share
 * link. Anything that does not match the server's id shape is treated as "not
 * a share link" so a stray `/d/...` URL renders the normal app instead of
 * firing a request that can only 400.
 */
export const getShareIdFromPath = (pathname: string): string | null => {
  if (!pathname.startsWith(SHARE_PATH_PREFIX)) return null;
  const raw = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, "");
  let shareId: string;
  try {
    shareId = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isShareIdValid(shareId) ? shareId : null;
};

export const buildShareUrl = (shareId: string, origin: string) =>
  `${origin}${SHARE_PATH_PREFIX}${shareId}`;

/**
 * Publishes a copy of the deck and returns its share id.
 *
 * Only the deck and its section's labels are sent — never the whole library,
 * and never study progress. A share link is a snapshot: later edits to the
 * local deck do not change what a recipient sees.
 */
export const createSharedDeck = async (deck: Deck, section: DeckSection) => {
  const response = await fetch("/api/shared-decks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deck,
      section: {
        id: section.id,
        title: section.title,
        description: section.description,
      },
    }),
  });
  if (!response.ok) throw new Error(await getFetchErrorMessage(response));
  const payload = (await response.json().catch(() => ({}))) as { shareId?: unknown };
  if (typeof payload.shareId !== "string" || !isShareIdValid(payload.shareId)) {
    throw new Error("The server did not return a usable share link.");
  }
  return payload.shareId;
};

export const fetchSharedDeck = async (shareId: string): Promise<SharedDeckSnapshot> => {
  const response = await fetch(`/api/shared-decks/${encodeURIComponent(shareId)}`);
  if (!response.ok) throw new Error(await getFetchErrorMessage(response));
  const payload = (await response.json().catch(() => ({}))) as { snapshot?: unknown };
  const snapshot = parseSharedDeckSnapshot(payload.snapshot);
  if (!snapshot) throw new Error("That shared deck could not be read.");
  return snapshot;
};

/**
 * Places a shared deck into a copy of the reader's library.
 *
 * Pure so the id rules can be tested directly: the deck is filed under a topic
 * the reader already has when one matches (by id, else by name), and both the
 * deck id and the card ids are re-minted against what the target topic already
 * holds. Ids arrive from someone else's library, so trusting them would let a
 * share collide with — or shadow — a deck the reader already had.
 */
export const importSharedDeck = (
  sections: DeckSection[],
  snapshot: SharedDeckSnapshot,
): { sections: DeckSection[]; deck: Deck } => {
  const { deck, section } = snapshot;

  const existingSection =
    sections.find((item) => item.id === section.id) ??
    sections.find(
      (item) => item.title.trim().toLowerCase() === section.title.trim().toLowerCase(),
    ) ??
    null;

  const usedDeckIds = new Set(sections.flatMap((item) => item.decks.map((d) => d.id)));
  // Card ids only have to be unique within a section (see sanitizeDeckSections),
  // so they are re-minted against the target topic rather than the whole library.
  const usedCardIds = (existingSection?.decks ?? []).flatMap((item) =>
    item.cards.map((card) => card.id),
  );

  const importedDeck: Deck = {
    id: createUniqueId(deck.title, usedDeckIds),
    title: deck.title,
    subtitle: deck.subtitle,
    cards: withCardIds(
      deck.cards.map(({ term, definition }) => ({ term, definition })),
      usedCardIds,
    ),
  };

  if (existingSection) {
    return {
      deck: importedDeck,
      sections: sections.map((item) =>
        item.id === existingSection.id ? { ...item, decks: [...item.decks, importedDeck] } : item,
      ),
    };
  }

  const usedSectionIds = new Set(sections.map((item) => item.id));
  return {
    deck: importedDeck,
    sections: [
      ...sections,
      {
        id: createUniqueId(section.title, usedSectionIds),
        title: section.title,
        description: section.description,
        decks: [importedDeck],
      },
    ],
  };
};
