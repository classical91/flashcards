/**
 * Deletion records for cloud sync.
 *
 * The old merge was additive: whatever either side had, the merge kept. That
 * made deletes impossible to sync — a stale device still holding a deleted
 * deck simply put it back on the next merge. A tombstone records *when* an id
 * was deleted so the other device can tell "never had it" apart from "deleted
 * it", and drop it too.
 *
 * Card ids are only unique within a section (see sanitizeDeckSections), so
 * card tombstones are keyed by deck as well.
 */
export type Tombstones = {
  sections: Record<string, number>;
  decks: Record<string, number>;
  cards: Record<string, number>;
};

/**
 * Tombstones are kept long enough that any device which has been offline for
 * a normal stretch still learns about the delete, then dropped so the snapshot
 * doesn't grow without bound. A device offline longer than this can resurrect
 * what it still holds — the same trade-off every tombstone-based sync makes.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const emptyTombstones = (): Tombstones => ({ sections: {}, decks: {}, cards: {} });

export const cardTombstoneKey = (deckId: string, cardId: string) => `${deckId}::${cardId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseTimestampMap = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
};

export const parseTombstones = (value: unknown): Tombstones => {
  if (!isRecord(value)) return emptyTombstones();
  return {
    sections: parseTimestampMap(value.sections),
    decks: parseTimestampMap(value.decks),
    cards: parseTimestampMap(value.cards),
  };
};

const mergeTimestampMaps = (
  local: Record<string, number>,
  remote: Record<string, number>,
): Record<string, number> => {
  const merged: Record<string, number> = { ...local };
  Object.entries(remote).forEach(([id, deletedAt]) => {
    const existing = merged[id];
    if (existing === undefined || deletedAt > existing) merged[id] = deletedAt;
  });
  return merged;
};

/** Union of both sides, keeping the later delete for ids both sides deleted. */
export const mergeTombstones = (local: Tombstones, remote: Tombstones): Tombstones => ({
  sections: mergeTimestampMaps(local.sections, remote.sections),
  decks: mergeTimestampMaps(local.decks, remote.decks),
  cards: mergeTimestampMaps(local.cards, remote.cards),
});

const pruneTimestampMap = (map: Record<string, number>, cutoff: number) =>
  Object.fromEntries(Object.entries(map).filter(([, deletedAt]) => deletedAt >= cutoff));

export const pruneTombstones = (tombstones: Tombstones, now = Date.now()): Tombstones => {
  const cutoff = now - TOMBSTONE_TTL_MS;
  return {
    sections: pruneTimestampMap(tombstones.sections, cutoff),
    decks: pruneTimestampMap(tombstones.decks, cutoff),
    cards: pruneTimestampMap(tombstones.cards, cutoff),
  };
};

/**
 * A delete only sticks while it is newer than the entity it covers, so an id
 * that is deleted on one device and then re-created (or edited) on another
 * survives instead of vanishing again on the next merge.
 */
export const isDeleted = (
  map: Record<string, number>,
  id: string,
  entityUpdatedAt: number | undefined,
) => {
  const deletedAt = map[id];
  if (deletedAt === undefined) return false;
  return (entityUpdatedAt ?? 0) <= deletedAt;
};

export const recordSectionDeletion = (
  tombstones: Tombstones,
  sectionId: string,
  deletedAt = Date.now(),
): Tombstones => ({
  ...tombstones,
  sections: { ...tombstones.sections, [sectionId]: deletedAt },
});

export const recordDeckDeletion = (
  tombstones: Tombstones,
  deckId: string,
  deletedAt = Date.now(),
): Tombstones => ({
  ...tombstones,
  decks: { ...tombstones.decks, [deckId]: deletedAt },
});

export const recordCardDeletion = (
  tombstones: Tombstones,
  deckId: string,
  cardId: string,
  deletedAt = Date.now(),
): Tombstones => ({
  ...tombstones,
  cards: { ...tombstones.cards, [cardTombstoneKey(deckId, cardId)]: deletedAt },
});

const without = (map: Record<string, number>, ids: Iterable<string>) => {
  const drop = new Set(ids);
  return Object.fromEntries(Object.entries(map).filter(([id]) => !drop.has(id)));
};

/**
 * Drops the deletions covering ids that are being deliberately brought back —
 * restoring a backup is a statement that its contents should exist, and
 * without this the very next merge would delete them again.
 */
export const forgetDeletions = (
  tombstones: Tombstones,
  ids: { sections: Iterable<string>; decks: Iterable<string>; cards: Iterable<string> },
): Tombstones => ({
  sections: without(tombstones.sections, ids.sections),
  decks: without(tombstones.decks, ids.decks),
  cards: without(tombstones.cards, ids.cards),
});

/** The section, deck and card-tombstone keys a set of sections covers. */
export const collectEntityIds = (
  sections: { id: string; decks: { id: string; cards: { id: string }[] }[] }[],
) => ({
  sections: sections.map((section) => section.id),
  decks: sections.flatMap((section) => section.decks.map((deck) => deck.id)),
  cards: sections.flatMap((section) =>
    section.decks.flatMap((deck) => deck.cards.map((card) => cardTombstoneKey(deck.id, card.id))),
  ),
});
