import { Deck, DeckSection } from "../data/deckBuilder";
import { DeckProgress, StudyMode } from "../data/librarySnapshot";

export type { Deck, DeckSection, DeckProgress, StudyMode };

export type DeckComposer = {
  sectionId: string;
  title: string;
  subtitle: string;
  paste: string;
};

export type SectionComposer = {
  title: string;
  description: string;
};

export type ConfirmDialog = {
  message: string;
  onConfirm: () => void;
};

export type SyncState = "idle" | "loading" | "saving" | "saved" | "error";

export type ViewState =
  | { kind: "home" }
  | { kind: "pinned" }
  | { kind: "section"; sectionId: string }
  | { kind: "study"; deckId: string };

export type AiModal = {
  word: string;
  prompt: string;
} | null;

export type Theme = "light" | "dark";
export type AccentColor = "blue" | "purple" | "green" | "red" | "amber";

export type RecentDeckEntry = { id: string; viewedAt: number };
