import { Deck, DeckSection } from "../data/deckBuilder";
import { DeckProgress, StudyMode } from "../data/librarySnapshot";
import { SharedDeckSnapshot } from "../data/sharedDeck";

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

export type SectionEditor = {
  sectionId: string;
  title: string;
  description: string;
};

export type ConfirmDialog = {
  message: string;
  onConfirm: () => void;
};

/**
 * The state of a `/d/<shareId>` link the reader followed.
 *
 * The link lands on whichever view the app opens with, and only the study view
 * renders the toast — so progress and failure are reported through the import
 * overlay itself rather than through `toast`, which would be invisible here.
 * Nothing is written to the library until the reader accepts.
 */
export type SharedDeckLink =
  | { status: "loading"; shareId: string }
  | { status: "ready"; shareId: string; snapshot: SharedDeckSnapshot }
  | { status: "error"; shareId: string; message: string };

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

/**
 * Deck id -> timestamp of the last time the deck was opened. Unlike
 * recentDeckIds (capped at MAX_RECENT_DECKS for the home page list) this keeps
 * an entry for every deck ever opened, so a topic's deck list can stay ordered
 * most-recently-viewed first no matter how many decks are in it.
 */
export type DeckLastViewed = Record<string, number>;
