export const LIBRARY_STORAGE_KEY = "flashcards.library.v2";
export const PROGRESS_STORAGE_KEY = "flashcards.progress.v2";
export const SELECTED_DECK_STORAGE_KEY = "flashcards.selectedDeck.v2";
export const SYNC_KEY_STORAGE_KEY = "flashcards.syncKey.v1";
export const PINNED_DECKS_STORAGE_KEY = "flashcards.pinnedDecks.v1";
export const RECENT_DECKS_STORAGE_KEY = "flashcards.recentDecks.v2";
export const THEME_STORAGE_KEY = "flashcards.theme.v1";
export const ACCENT_STORAGE_KEY = "flashcards.accent.v1";
export const MAX_RECENT_DECKS = 6;

export const DEFAULT_SYNC_KEY =
  import.meta.env.VITE_FLASHCARDS_SYNC_KEY?.trim() || "jasons-flashcards-library";
export const syncKeyPattern = /^[A-Za-z0-9_-]{8,120}$/;

export const ACCENT_COLORS = ["blue", "purple", "green", "red", "amber"] as const;
