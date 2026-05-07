import { DeckSection } from "./deckBuilder";

export type StudyMode = "all" | "remaining";

export type DeckProgress = {
  currentCardId: string;
  knownIds: string[];
  isFlipped: boolean;
  studyMode: StudyMode;
};

export type LibrarySnapshot = {
  version: 1;
  exportedAt: string;
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  selectedDeckId: string;
  recentDeckIds: string[];
};

type CreateLibrarySnapshotOptions = {
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  selectedDeckId: string;
  recentDeckIds: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFlashcard = (value: unknown) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.term === "string" &&
  typeof value.definition === "string";

const isDeck = (value: unknown) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  Array.isArray(value.cards) &&
  value.cards.every(isFlashcard);

const isDeckSection = (value: unknown) =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.description === "string" &&
  Array.isArray(value.decks) &&
  value.decks.every(isDeck);

const isStudyMode = (value: unknown): value is StudyMode =>
  value === "all" || value === "remaining";

const isDeckProgress = (value: unknown): value is DeckProgress =>
  isRecord(value) &&
  typeof value.currentCardId === "string" &&
  Array.isArray(value.knownIds) &&
  value.knownIds.every((item) => typeof item === "string") &&
  typeof value.isFlipped === "boolean" &&
  isStudyMode(value.studyMode);

export const parseLibrarySnapshot = (value: unknown): LibrarySnapshot | null => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.exportedAt !== "string" ||
    !Array.isArray(value.librarySections) ||
    !value.librarySections.every(isDeckSection) ||
    !isRecord(value.deckProgress) ||
    typeof value.selectedDeckId !== "string"
  ) {
    return null;
  }

  const deckProgressEntries = Object.values(value.deckProgress);

  if (!deckProgressEntries.every(isDeckProgress)) {
    return null;
  }

  const recentDeckIds =
    Array.isArray(value.recentDeckIds) &&
    value.recentDeckIds.every((item) => typeof item === "string")
      ? Array.from(new Set(value.recentDeckIds))
      : [];

  return {
    version: 1,
    exportedAt: value.exportedAt,
    librarySections: value.librarySections as DeckSection[],
    deckProgress: value.deckProgress as Record<string, DeckProgress>,
    selectedDeckId: value.selectedDeckId,
    recentDeckIds,
  };
};

export const createLibrarySnapshot = ({
  librarySections,
  deckProgress,
  selectedDeckId,
  recentDeckIds,
}: CreateLibrarySnapshotOptions): LibrarySnapshot => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  librarySections,
  deckProgress,
  selectedDeckId,
  recentDeckIds,
});
