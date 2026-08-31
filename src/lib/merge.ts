import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";
import {
  DeckProgress,
  RecentDeckEntry,
  SyncedPreferences,
  defaultPreferences,
} from "../data/librarySnapshot";
import { MAX_RECENT_DECKS } from "./constants";
import { createDeckProgress, flattenDecks } from "./deckUtils";
import {
  Tombstones,
  cardTombstoneKey,
  emptyTombstones,
  isDeleted,
  mergeTombstones,
  pruneTombstones,
} from "./tombstones";

export type LibraryState = {
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  tombstones: Tombstones;
  preferences: SyncedPreferences;
};

const stamp = (entity: { updatedAt?: number } | undefined) => entity?.updatedAt ?? 0;

/**
 * Picks between two versions of the same entity. Ties go to `local` so a merge
 * is stable: re-running it on the result never flips the choice, and a device
 * that has nothing new doesn't churn the snapshot (and the cloud revision)
 * just by reconnecting.
 */
const newerOf = <T extends { updatedAt?: number }>(local: T | undefined, remote: T | undefined) => {
  if (!local) return remote;
  if (!remote) return local;
  return stamp(remote) > stamp(local) ? remote : local;
};

/** Local order first, then whatever only the other side has, in its own order. */
const orderedIds = <T extends { id: string }>(local: T[], remote: T[]) => {
  const ids = local.map((item) => item.id);
  const seen = new Set(ids);
  remote.forEach((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      ids.push(item.id);
    }
  });
  return ids;
};

const byId = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, item]));

const mergeCards = (
  deckId: string,
  localCards: Flashcard[],
  remoteCards: Flashcard[],
  tombstones: Tombstones,
): Flashcard[] => {
  const local = byId(localCards);
  const remote = byId(remoteCards);
  return orderedIds(localCards, remoteCards)
    .map((cardId) => newerOf(local.get(cardId), remote.get(cardId)))
    .filter((card): card is Flashcard => {
      if (!card) return false;
      return !isDeleted(tombstones.cards, cardTombstoneKey(deckId, card.id), card.updatedAt);
    })
    .map((card) => ({ ...card }));
};

const mergeDecks = (
  localDecks: Deck[],
  remoteDecks: Deck[],
  tombstones: Tombstones,
  claimedDeckIds: Set<string>,
): Deck[] => {
  const local = byId(localDecks);
  const remote = byId(remoteDecks);
  const merged: Deck[] = [];

  orderedIds(localDecks, remoteDecks).forEach((deckId) => {
    // A deck listed by both sides under different sections is kept once, in
    // whichever merged section reaches it first.
    if (claimedDeckIds.has(deckId)) return;
    const localDeck = local.get(deckId);
    const remoteDeck = remote.get(deckId);
    const winner = newerOf(localDeck, remoteDeck);
    if (!winner) return;
    if (isDeleted(tombstones.decks, deckId, Math.max(stamp(localDeck), stamp(remoteDeck)))) return;
    claimedDeckIds.add(deckId);
    merged.push({
      ...winner,
      cards: mergeCards(deckId, localDeck?.cards ?? [], remoteDeck?.cards ?? [], tombstones),
    });
  });

  return merged;
};

const mergeSectionLists = (
  localSections: DeckSection[],
  remoteSections: DeckSection[],
  tombstones: Tombstones,
): DeckSection[] => {
  const local = byId(localSections);
  const remote = byId(remoteSections);
  const claimedDeckIds = new Set<string>();
  const merged: DeckSection[] = [];

  orderedIds(localSections, remoteSections).forEach((sectionId) => {
    const localSection = local.get(sectionId);
    const remoteSection = remote.get(sectionId);
    const winner = newerOf(localSection, remoteSection);
    if (!winner) return;
    if (
      isDeleted(tombstones.sections, sectionId, Math.max(stamp(localSection), stamp(remoteSection)))
    ) {
      return;
    }
    merged.push({
      ...winner,
      decks: mergeDecks(
        localSection?.decks ?? [],
        remoteSection?.decks ?? [],
        tombstones,
        claimedDeckIds,
      ),
    });
  });

  return merged;
};

const mergeDeckProgress = (
  localProgress: Record<string, DeckProgress>,
  remoteProgress: Record<string, DeckProgress>,
  sections: DeckSection[],
): Record<string, DeckProgress> => {
  const merged: Record<string, DeckProgress> = {};

  flattenDecks(sections).forEach((deck) => {
    const local = localProgress[deck.id];
    const remote = remoteProgress[deck.id];
    const validCardIds = new Set(deck.cards.map((card) => card.id));

    let base: DeckProgress;
    if (local && remote) {
      // Libraries saved before progress carried a stamp have nothing to
      // compare, so they keep the old additive behaviour rather than letting
      // an arbitrary side erase the other's marks. Once either device has
      // written stamped progress, last-writer-wins takes over and an unmark
      // stops bouncing back.
      if (local.updatedAt === undefined && remote.updatedAt === undefined) {
        base = { ...local, knownIds: Array.from(new Set([...remote.knownIds, ...local.knownIds])) };
      } else {
        base = newerOf(local, remote) as DeckProgress;
      }
    } else {
      base = local ?? remote ?? createDeckProgress(deck);
    }

    const knownIds = base.knownIds.filter((id) => validCardIds.has(id));
    const reviews = Object.fromEntries(
      Object.entries(base.reviews ?? {}).filter(([cardId]) => validCardIds.has(cardId)),
    );
    merged[deck.id] = {
      ...base,
      knownIds,
      reviews,
      currentCardId: validCardIds.has(base.currentCardId)
        ? base.currentCardId
        : (deck.cards[0]?.id ?? ""),
    };
  });

  return merged;
};

const mergeTimestampsByDeck = (
  local: Record<string, number>,
  remote: Record<string, number>,
  liveDeckIds: Set<string>,
) => {
  const merged: Record<string, number> = {};
  [local, remote].forEach((source) => {
    Object.entries(source).forEach(([deckId, at]) => {
      if (!liveDeckIds.has(deckId)) return;
      if (merged[deckId] === undefined || at > merged[deckId]) merged[deckId] = at;
    });
  });
  return merged;
};

const mergeRecentDecks = (
  local: RecentDeckEntry[],
  remote: RecentDeckEntry[],
  liveDeckIds: Set<string>,
): RecentDeckEntry[] => {
  const byDeck = mergeTimestampsByDeck(
    Object.fromEntries(local.map((entry) => [entry.id, entry.viewedAt])),
    Object.fromEntries(remote.map((entry) => [entry.id, entry.viewedAt])),
    liveDeckIds,
  );
  return Object.entries(byDeck)
    .map(([id, viewedAt]) => ({ id, viewedAt }))
    .sort((a, b) =>
      b.viewedAt === a.viewedAt ? a.id.localeCompare(b.id) : b.viewedAt - a.viewedAt,
    )
    .slice(0, MAX_RECENT_DECKS);
};

const mergePreferences = (
  local: SyncedPreferences,
  remote: SyncedPreferences,
  liveDeckIds: Set<string>,
): SyncedPreferences => {
  // Pins, theme and accent move as one group: they have no per-item stamp, so
  // splitting them would let a device half-apply someone else's settings.
  const group = remote.updatedAt > local.updatedAt ? remote : local;
  return {
    pinnedDeckIds: group.pinnedDeckIds.filter((deckId) => liveDeckIds.has(deckId)),
    theme: group.theme,
    accentColor: group.accentColor,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    deckLastViewed: mergeTimestampsByDeck(local.deckLastViewed, remote.deckLastViewed, liveDeckIds),
    recentDecks: mergeRecentDecks(local.recentDecks, remote.recentDecks, liveDeckIds),
  };
};

/**
 * Merges this device's library with the cloud's.
 *
 * The rules are deterministic and symmetric enough to converge: tombstones
 * remove what either side deleted, per-entity `updatedAt` settles simultaneous
 * edits, and every tie falls to `local` so repeated merges are stable.
 */
export const mergeLibraryState = (
  local: LibraryState,
  remote: LibraryState,
  now = Date.now(),
): LibraryState => {
  const tombstones = pruneTombstones(mergeTombstones(local.tombstones, remote.tombstones), now);
  const librarySections = mergeSectionLists(
    local.librarySections,
    remote.librarySections,
    tombstones,
  );
  const liveDeckIds = new Set(flattenDecks(librarySections).map((deck) => deck.id));

  return {
    librarySections,
    deckProgress: mergeDeckProgress(local.deckProgress, remote.deckProgress, librarySections),
    tombstones,
    preferences: mergePreferences(local.preferences, remote.preferences, liveDeckIds),
  };
};

export const emptyLibraryState = (): LibraryState => ({
  librarySections: [],
  deckProgress: {},
  tombstones: emptyTombstones(),
  preferences: defaultPreferences(),
});
