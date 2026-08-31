import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";
import {
  DeckProgress,
  RecentDeckEntry,
  SyncedPreferences,
  defaultPreferences,
} from "../data/librarySnapshot";
import { ReviewState } from "./srs";
import { MAX_RECENT_DECKS } from "./constants";
import { flattenDecks } from "./deckUtils";
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

/**
 * When the container an entity lives in was deleted, or -1 if it wasn't.
 *
 * Deleting a deck records one tombstone for the deck, not one per card — a
 * 5,000-card deck would otherwise blow past the snapshot's tombstone budget.
 * Cards are checked against it instead, which covers the case that matters:
 * an id is slug-derived, so deleting "Biology" and later creating another deck
 * by that name reuses the id. The new deck outlives its own tombstone because
 * it is stamped later, and its cards do too — but the old incarnation's cards,
 * still sitting on a device that hasn't synced, are older than the delete and
 * are dropped instead of being unioned back in.
 */
const containerDeletedAt = (tombstones: Tombstones, sectionId: string, deckId?: string) =>
  Math.max(
    tombstones.sections[sectionId] ?? -1,
    deckId === undefined ? -1 : (tombstones.decks[deckId] ?? -1),
  );

const outlivesContainer = (entity: { updatedAt?: number }, deletedAt: number) =>
  stamp(entity) > deletedAt;

const mergeCards = (
  sectionId: string,
  deckId: string,
  localCards: Flashcard[],
  remoteCards: Flashcard[],
  tombstones: Tombstones,
): Flashcard[] => {
  const local = byId(localCards);
  const remote = byId(remoteCards);
  const deletedAt = containerDeletedAt(tombstones, sectionId, deckId);
  return orderedIds(localCards, remoteCards)
    .map((cardId) => newerOf(local.get(cardId), remote.get(cardId)))
    .filter((card): card is Flashcard => {
      if (!card) return false;
      if (isDeleted(tombstones.cards, cardTombstoneKey(deckId, card.id), card.updatedAt)) {
        return false;
      }
      return outlivesContainer(card, deletedAt);
    })
    .map((card) => ({ ...card }));
};

const mergeDecks = (
  sectionId: string,
  localDecks: Deck[],
  remoteDecks: Deck[],
  tombstones: Tombstones,
  claimedDeckIds: Set<string>,
): Deck[] => {
  const local = byId(localDecks);
  const remote = byId(remoteDecks);
  const sectionDeletedAt = containerDeletedAt(tombstones, sectionId);
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
    // Same rule one level up: a topic deleted and re-created under the same id
    // must not pull its old decks back off a stale device.
    if (!outlivesContainer(winner, sectionDeletedAt)) return;
    claimedDeckIds.add(deckId);
    merged.push({
      ...winner,
      cards: mergeCards(
        sectionId,
        deckId,
        localDeck?.cards ?? [],
        remoteDeck?.cards ?? [],
        tombstones,
      ),
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
        sectionId,
        localSection?.decks ?? [],
        remoteSection?.decks ?? [],
        tombstones,
        claimedDeckIds,
      ),
    });
  });

  return merged;
};

/** Per-card union keeping the later timestamp for ids both sides recorded. */
const mergeStampsByCard = (
  local: Record<string, number> | undefined,
  remote: Record<string, number> | undefined,
  validCardIds: Set<string>,
) => {
  const merged: Record<string, number> = {};
  [local ?? {}, remote ?? {}].forEach((source) => {
    Object.entries(source).forEach(([cardId, at]) => {
      if (!validCardIds.has(cardId)) return;
      if (merged[cardId] === undefined || at > merged[cardId]) merged[cardId] = at;
    });
  });
  return merged;
};

/**
 * Merges review schedules one card at a time, newest review winning.
 *
 * Taking whole progress objects would mean a card graded on the phone is
 * erased the moment the laptop so much as navigates — the two devices were
 * never really in conflict, they touched different cards.
 *
 * `resetAt` is the exception: a schedule from before a reset is discarded, so
 * "Reset progress" reaches other devices instead of being refilled by whoever
 * still holds the old schedules.
 */
const mergeReviews = (
  local: DeckProgress | undefined,
  remote: DeckProgress | undefined,
  validCardIds: Set<string>,
  resetAt: number,
) => {
  const merged: Record<string, ReviewState> = {};
  const cardIds = new Set([
    ...Object.keys(local?.reviews ?? {}),
    ...Object.keys(remote?.reviews ?? {}),
  ]);

  cardIds.forEach((cardId) => {
    if (!validCardIds.has(cardId)) return;
    const localReview = local?.reviews?.[cardId];
    const remoteReview = remote?.reviews?.[cardId];
    const winner =
      localReview && remoteReview
        ? remoteReview.lastReviewedAt > localReview.lastReviewedAt
          ? remoteReview
          : localReview
        : (localReview ?? remoteReview);
    if (!winner || winner.lastReviewedAt <= resetAt) return;
    merged[cardId] = winner;
  });

  return merged;
};

/**
 * Merges known marks one card at a time.
 *
 * A card's membership is decided by whichever side last changed it. A side
 * that has a stamp for the card beats one that doesn't, so an explicit unmark
 * wins over a mark carried along by a client too old to stamp anything. When
 * neither side has ever stamped the card the marks are unioned, which is how
 * this worked before stamps existed — an upgrade shouldn't drop progress.
 */
const mergeKnownIds = (
  local: DeckProgress | undefined,
  remote: DeckProgress | undefined,
  validCardIds: Set<string>,
  knownUpdatedAt: Record<string, number>,
) => {
  const localKnown = new Set(local?.knownIds ?? []);
  const remoteKnown = new Set(remote?.knownIds ?? []);
  const candidates = new Set([...localKnown, ...remoteKnown, ...Object.keys(knownUpdatedAt)]);
  const known: string[] = [];

  candidates.forEach((cardId) => {
    if (!validCardIds.has(cardId)) return;
    const localStamp = local?.knownUpdatedAt?.[cardId];
    const remoteStamp = remote?.knownUpdatedAt?.[cardId];
    const isKnown =
      localStamp === undefined && remoteStamp === undefined
        ? localKnown.has(cardId) || remoteKnown.has(cardId)
        : remoteStamp === undefined
          ? localKnown.has(cardId)
          : localStamp === undefined
            ? remoteKnown.has(cardId)
            : remoteStamp > localStamp
              ? remoteKnown.has(cardId)
              : localKnown.has(cardId);
    if (isKnown) known.push(cardId);
  });

  return known;
};

/** Where the user was in the deck. Flipping deliberately doesn't count. */
const positionStamp = (progress: DeckProgress | undefined) =>
  progress?.positionUpdatedAt ?? progress?.updatedAt ?? 0;

const mergeOneDeckProgress = (
  local: DeckProgress | undefined,
  remote: DeckProgress | undefined,
  deck: Deck,
): DeckProgress => {
  const validCardIds = new Set(deck.cards.map((card) => card.id));
  const resetAt = Math.max(local?.resetAt ?? 0, remote?.resetAt ?? 0);
  const knownUpdatedAt = mergeStampsByCard(
    local?.knownUpdatedAt,
    remote?.knownUpdatedAt,
    validCardIds,
  );
  const knownIds = mergeKnownIds(local, remote, validCardIds, knownUpdatedAt);
  const position =
    local && remote
      ? positionStamp(remote) > positionStamp(local)
        ? remote
        : local
      : (local ?? remote);

  const currentCardId = position?.currentCardId ?? "";
  const updatedAt = Math.max(local?.updatedAt ?? 0, remote?.updatedAt ?? 0);

  return {
    currentCardId: validCardIds.has(currentCardId) ? currentCardId : (deck.cards[0]?.id ?? ""),
    knownIds,
    // Whether the card in front of you is face up is about this screen right
    // now, not about the library, so it is never taken from the other device.
    isFlipped: local?.isFlipped ?? false,
    studyMode: position?.studyMode ?? "all",
    reviews: mergeReviews(local, remote, validCardIds, resetAt),
    knownUpdatedAt,
    positionUpdatedAt: Math.max(positionStamp(local), positionStamp(remote)),
    ...(resetAt > 0 ? { resetAt } : {}),
    ...(updatedAt > 0 ? { updatedAt } : {}),
  };
};

const mergeDeckProgress = (
  localProgress: Record<string, DeckProgress>,
  remoteProgress: Record<string, DeckProgress>,
  sections: DeckSection[],
): Record<string, DeckProgress> => {
  const merged: Record<string, DeckProgress> = {};

  flattenDecks(sections).forEach((deck) => {
    // Run even when neither side has progress for the deck: the result is the
    // same fresh entry createDeckProgress would give, and going through one
    // path keeps merging idempotent in shape as well as in meaning.
    merged[deck.id] = mergeOneDeckProgress(localProgress[deck.id], remoteProgress[deck.id], deck);
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
