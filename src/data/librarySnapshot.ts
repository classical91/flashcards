import { AccentColor, ACCENT_COLORS, Theme } from "../lib/constants";
import {
  Tombstones,
  cardTombstoneKey,
  emptyTombstones,
  parseTombstones,
} from "../lib/tombstones";
import { ReviewState, parseReviews } from "../lib/srs";
import { DeckSection, sanitizeDeckSections } from "./deckBuilder";

export type StudyMode = "all" | "remaining";

export type DeckProgress = {
  currentCardId: string;
  knownIds: string[];
  isFlipped: boolean;
  studyMode: StudyMode;
  /**
   * Epoch ms of the last change to this deck's progress. The merge uses it to
   * settle two devices that disagree about what is known — without it, an
   * unmark on one device is undone by the other device's stale list.
   */
  /**
   * Kept for clients that predate per-field merging and settle progress by
   * comparing whole objects. Nothing in this codebase merges on it any more.
   */
  updatedAt?: number;
  /**
   * Card id -> spaced-repetition schedule. Optional: a deck only gains one
   * once its cards have been graded, and libraries saved before review mode
   * have none at all.
   */
  reviews?: Record<string, ReviewState>;
  /**
   * Card id -> when that card's known state last changed, marked or unmarked.
   * Without it, two devices marking different cards can only be merged by
   * taking one side's whole list and discarding the other's.
   */
  knownUpdatedAt?: Record<string, number>;
  /** When currentCardId or studyMode last changed. Flipping is not a change. */
  positionUpdatedAt?: number;
  /**
   * When this deck's progress was last reset. Review schedules older than it
   * are dropped, so a reset reaches other devices instead of being refilled
   * by whichever one still holds the old schedules.
   */
  resetAt?: number;
};

export type RecentDeckEntry = { id: string; viewedAt: number };

/**
 * Deck id -> timestamp of the last time the deck was opened. Unlike
 * recentDecks (capped at MAX_RECENT_DECKS for the home page list) this keeps
 * an entry for every deck ever opened, so a topic's deck list can stay ordered
 * most-recently-viewed first no matter how many decks are in it.
 */
export type DeckLastViewed = Record<string, number>;

/**
 * Device preferences that follow the library between devices. Pins, theme and
 * accent are a single last-writer-wins group stamped by `updatedAt`; the two
 * timestamped maps merge per deck instead, since "opened at" is objective and
 * the newer read is always the right one.
 */
export type SyncedPreferences = {
  pinnedDeckIds: string[];
  recentDecks: RecentDeckEntry[];
  deckLastViewed: DeckLastViewed;
  theme: Theme;
  accentColor: AccentColor;
  updatedAt: number;
};

export const SNAPSHOT_VERSION = 2;

export type LibrarySnapshot = {
  version: 2;
  exportedAt: string;
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  selectedDeckId: string;
  /**
   * Flat id list, kept alongside `preferences.recentDecks` so a device still
   * running the v1 client (and the server's snapshot validation) sees the
   * shape it expects.
   */
  recentDeckIds: string[];
  tombstones: Tombstones;
  preferences: SyncedPreferences;
};

type CreateLibrarySnapshotOptions = {
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  selectedDeckId: string;
  tombstones?: Tombstones;
  preferences?: SyncedPreferences;
};

export const defaultPreferences = (): SyncedPreferences => ({
  pinnedDeckIds: [],
  recentDecks: [],
  deckLastViewed: {},
  theme: "light",
  accentColor: "blue",
  // Zero so a library that predates preference sync never wins a merge
  // against a device that has actually set something.
  updatedAt: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseUpdatedAt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const withOptionalUpdatedAt = <T extends object>(entity: T, updatedAt: number | undefined): T =>
  updatedAt === undefined ? entity : { ...entity, updatedAt };

const parseFlashcard = (value: unknown): DeckSection["decks"][number]["cards"][number] | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.term !== "string" ||
    typeof value.definition !== "string"
  ) {
    return null;
  }

  return withOptionalUpdatedAt(
    {
      id: value.id,
      term: value.term,
      definition: value.definition,
    },
    parseUpdatedAt(value.updatedAt),
  );
};

const parseDeck = (value: unknown): DeckSection["decks"][number] | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.cards)
  ) {
    return null;
  }

  const cards = value.cards.map(parseFlashcard);
  if (cards.some((card) => !card)) {
    return null;
  }

  return withOptionalUpdatedAt(
    {
      id: value.id,
      title: value.title,
      subtitle: typeof value.subtitle === "string" ? value.subtitle : "",
      cards: cards as DeckSection["decks"][number]["cards"],
    },
    parseUpdatedAt(value.updatedAt),
  );
};

const parseDeckSection = (value: unknown): DeckSection | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.decks)
  ) {
    return null;
  }

  const decks = value.decks.map(parseDeck);
  if (decks.some((deck) => !deck)) {
    return null;
  }

  return withOptionalUpdatedAt(
    {
      id: value.id,
      title: value.title,
      description: typeof value.description === "string" ? value.description : "",
      decks: decks as DeckSection["decks"],
    },
    parseUpdatedAt(value.updatedAt),
  );
};

const isStudyMode = (value: unknown): value is StudyMode =>
  value === "all" || value === "remaining";

const isDeckProgress = (value: unknown): value is DeckProgress =>
  isRecord(value) &&
  typeof value.currentCardId === "string" &&
  Array.isArray(value.knownIds) &&
  value.knownIds.every((item) => typeof item === "string") &&
  typeof value.isFlipped === "boolean" &&
  isStudyMode(value.studyMode);

export const parseRecentDecks = (value: unknown): RecentDeckEntry[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: RecentDeckEntry[] = [];
  value.forEach((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.viewedAt !== "number" ||
      !Number.isFinite(item.viewedAt) ||
      seen.has(item.id)
    ) {
      return;
    }
    seen.add(item.id);
    entries.push({ id: item.id, viewedAt: item.viewedAt });
  });
  return entries;
};

/** Reads an `id -> epoch ms` map, dropping anything that isn't a real number. */
export const parseTimestampsById = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
};

const parsePreferences = (value: unknown, fallbackRecentIds: string[]): SyncedPreferences => {
  const defaults = defaultPreferences();
  if (!isRecord(value)) {
    // A v1 snapshot still carried a flat recents list; keep it so upgrading
    // doesn't wipe the home page's "recently viewed" row.
    return {
      ...defaults,
      recentDecks: fallbackRecentIds.map((id) => ({ id, viewedAt: 0 })),
    };
  }
  return {
    pinnedDeckIds:
      Array.isArray(value.pinnedDeckIds) &&
      value.pinnedDeckIds.every((item) => typeof item === "string")
        ? Array.from(new Set(value.pinnedDeckIds as string[]))
        : defaults.pinnedDeckIds,
    recentDecks: parseRecentDecks(value.recentDecks),
    deckLastViewed: parseTimestampsById(value.deckLastViewed),
    theme: value.theme === "dark" || value.theme === "light" ? value.theme : defaults.theme,
    accentColor: (ACCENT_COLORS as readonly string[]).includes(String(value.accentColor))
      ? (value.accentColor as AccentColor)
      : defaults.accentColor,
    updatedAt: parseUpdatedAt(value.updatedAt) ?? defaults.updatedAt,
  };
};

export const parseLibrarySections = (value: unknown): DeckSection[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const sections = value.map(parseDeckSection);
  if (sections.some((section) => !section)) {
    return null;
  }

  return sections as DeckSection[];
};

/**
 * Rewrites every id-keyed structure through the maps returned by
 * sanitizeDeckSections, so a repaired deck/card id doesn't strand the progress,
 * tombstones and preferences that point at the old one.
 */
const remapById = (
  deckIdMap: Map<string, string>,
  cardIdMap: Map<string, string>,
  input: {
    deckProgress: Record<string, DeckProgress>;
    selectedDeckId: string;
    tombstones: Tombstones;
    preferences: SyncedPreferences;
  },
) => {
  const deckId = (id: string) => deckIdMap.get(id) ?? id;
  const cardId = (id: string) => cardIdMap.get(id) ?? id;

  const deckProgress = Object.fromEntries(
    Object.entries(input.deckProgress).map(([id, progress]) => [
      deckId(id),
      {
        ...progress,
        currentCardId: cardId(progress.currentCardId),
        knownIds: progress.knownIds.map(cardId),
        reviews: Object.fromEntries(
          Object.entries(parseReviews(progress.reviews)).map(([card, state]) => [
            cardId(card),
            state,
          ]),
        ),
        knownUpdatedAt: Object.fromEntries(
          Object.entries(parseTimestampsById(progress.knownUpdatedAt)).map(([card, at]) => [
            cardId(card),
            at,
          ]),
        ),
      },
    ]),
  );

  const tombstones: Tombstones = {
    sections: input.tombstones.sections,
    decks: Object.fromEntries(
      Object.entries(input.tombstones.decks).map(([id, at]) => [deckId(id), at]),
    ),
    cards: Object.fromEntries(
      Object.entries(input.tombstones.cards).map(([key, at]) => {
        const separator = key.indexOf("::");
        if (separator < 0) return [key, at];
        const deck = key.slice(0, separator);
        const card = key.slice(separator + 2);
        return [cardTombstoneKey(deckId(deck), cardId(card)), at];
      }),
    ),
  };

  const preferences: SyncedPreferences = {
    ...input.preferences,
    pinnedDeckIds: input.preferences.pinnedDeckIds.map(deckId),
    recentDecks: input.preferences.recentDecks.map((entry) => ({
      ...entry,
      id: deckId(entry.id),
    })),
    deckLastViewed: Object.fromEntries(
      Object.entries(input.preferences.deckLastViewed).map(([id, at]) => [deckId(id), at]),
    ),
  };

  return {
    deckProgress,
    selectedDeckId: deckId(input.selectedDeckId),
    tombstones,
    preferences,
  };
};

export const parseLibrarySnapshot = (value: unknown): LibrarySnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }

  const librarySections = parseLibrarySections(value.librarySections);

  if (
    (value.version !== 1 && value.version !== SNAPSHOT_VERSION) ||
    typeof value.exportedAt !== "string" ||
    !librarySections ||
    !isRecord(value.deckProgress) ||
    typeof value.selectedDeckId !== "string"
  ) {
    return null;
  }

  const deckProgressEntries = Object.values(value.deckProgress);

  if (!deckProgressEntries.every(isDeckProgress)) {
    return null;
  }

  const rawRecentDeckIds =
    Array.isArray(value.recentDeckIds) &&
    value.recentDeckIds.every((item) => typeof item === "string")
      ? Array.from(new Set(value.recentDeckIds as string[]))
      : [];

  // Cloud snapshots can predate the 120-char id limit (or come from a device
  // that hasn't picked up the fix yet), so repair ids here too and remap the
  // state that's keyed by them — otherwise a bad id just keeps bouncing
  // between cloud and every connected device.
  const { sections: sanitizedSections, deckIdMap, cardIdMap } =
    sanitizeDeckSections(librarySections);

  const remapped = remapById(deckIdMap, cardIdMap, {
    deckProgress: value.deckProgress as Record<string, DeckProgress>,
    selectedDeckId: value.selectedDeckId,
    tombstones: parseTombstones(value.tombstones),
    preferences: parsePreferences(value.preferences, rawRecentDeckIds),
  });

  return {
    version: SNAPSHOT_VERSION,
    exportedAt: value.exportedAt,
    librarySections: sanitizedSections,
    deckProgress: remapped.deckProgress,
    selectedDeckId: remapped.selectedDeckId,
    recentDeckIds: remapped.preferences.recentDecks.map((entry) => entry.id),
    tombstones: remapped.tombstones,
    preferences: remapped.preferences,
  };
};

export const createLibrarySnapshot = ({
  librarySections,
  deckProgress,
  selectedDeckId,
  tombstones = emptyTombstones(),
  preferences = defaultPreferences(),
}: CreateLibrarySnapshotOptions): LibrarySnapshot => {
  const { sections, deckIdMap, cardIdMap } = sanitizeDeckSections(librarySections);

  const remapped = remapById(deckIdMap, cardIdMap, {
    deckProgress,
    selectedDeckId,
    tombstones,
    preferences,
  });

  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    librarySections: sections,
    deckProgress: remapped.deckProgress,
    selectedDeckId: remapped.selectedDeckId,
    recentDeckIds: remapped.preferences.recentDecks.map((entry) => entry.id),
    tombstones: remapped.tombstones,
    preferences: remapped.preferences,
  };
};
