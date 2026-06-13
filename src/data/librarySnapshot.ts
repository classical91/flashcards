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

const parseFlashcard = (value: unknown): DeckSection["decks"][number]["cards"][number] | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.term !== "string" ||
    typeof value.definition !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    term: value.term,
    definition: value.definition,
  };
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

  return {
    id: value.id,
    title: value.title,
    subtitle: typeof value.subtitle === "string" ? value.subtitle : "",
    cards: cards as DeckSection["decks"][number]["cards"],
  };
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

  return {
    id: value.id,
    title: value.title,
    description: typeof value.description === "string" ? value.description : "",
    decks: decks as DeckSection["decks"],
  };
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

export const parseLibrarySnapshot = (value: unknown): LibrarySnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }

  const librarySections = parseLibrarySections(value.librarySections);

  if (
    value.version !== 1 ||
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

  const recentDeckIds =
    Array.isArray(value.recentDeckIds) &&
    value.recentDeckIds.every((item) => typeof item === "string")
      ? Array.from(new Set(value.recentDeckIds))
      : [];

  return {
    version: 1,
    exportedAt: value.exportedAt,
    librarySections,
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
