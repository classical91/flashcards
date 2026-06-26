import { defaultDeckId, starterSections } from "../data/decks";
import { DeckSection, sanitizeDeckSections } from "../data/deckBuilder";
import { DeckProgress, parseLibrarySections } from "../data/librarySnapshot";
import {
  ACCENT_COLORS,
  ACCENT_STORAGE_KEY,
  BUILD_SYNC_KEY,
  LIBRARY_STORAGE_KEY,
  PINNED_DECKS_STORAGE_KEY,
  PROGRESS_STORAGE_KEY,
  RECENT_DECKS_STORAGE_KEY,
  SELECTED_DECK_STORAGE_KEY,
  SYNC_KEY_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./constants";
import { buildProgressState, cloneSections } from "./deckUtils";
import { createSyncKey, getBuildSyncKey, isSyncKeyValid } from "./sync";
import { AccentColor, RecentDeckEntry, Theme } from "./types";

/**
 * Writes to localStorage while swallowing quota/security errors so the app
 * keeps working in private-mode browsers or when storage is full.
 */
export const safeSetItem = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota exceeded / security errors — persistence is best-effort.
  }
};

export const safeRemoveItem = (key: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore security errors.
  }
};

export const loadTheme = (): Theme => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "light";
};

export const loadAccentColor = (): AccentColor => {
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if ((ACCENT_COLORS as readonly string[]).includes(stored || "")) {
      return stored as AccentColor;
    }
  } catch {}
  return "blue";
};

// Cached for the current load cycle so the id repair from sanitizeDeckSections
// (see loadLibrarySections) can also be applied to progress/pins/recents/
// selection, which are loaded separately but key off the same deck/card ids.
let cachedSanitizeResult: ReturnType<typeof sanitizeDeckSections> | null = null;

const loadRawLibrarySections = (): DeckSection[] => {
  if (typeof window === "undefined") return cloneSections(starterSections);
  const saved = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
  if (!saved) return cloneSections(starterSections);
  try {
    const parsed = parseLibrarySections(JSON.parse(saved));
    if (!parsed || parsed.length === 0) return cloneSections(starterSections);
    return parsed;
  } catch {
    return cloneSections(starterSections);
  }
};

export const loadLibrarySections = () => {
  cachedSanitizeResult = sanitizeDeckSections(loadRawLibrarySections());
  return cachedSanitizeResult.sections;
};

export const loadProgressState = (sections: DeckSection[]) => {
  const { deckIdMap, cardIdMap } = cachedSanitizeResult ?? sanitizeDeckSections(sections);
  if (typeof window === "undefined") return buildProgressState(sections);
  const saved = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (!saved) return buildProgressState(sections);
  try {
    const parsed = JSON.parse(saved) as Record<string, DeckProgress>;
    if (!parsed || typeof parsed !== "object") return buildProgressState(sections);
    return Object.fromEntries(
      Object.entries(parsed).map(([deckId, progress]) => [
        deckIdMap.get(deckId) ?? deckId,
        {
          ...progress,
          currentCardId: cardIdMap.get(progress.currentCardId) ?? progress.currentCardId,
          knownIds: progress.knownIds.map((id) => cardIdMap.get(id) ?? id),
        },
      ]),
    );
  } catch {
    return buildProgressState(sections);
  }
};

export const loadSelectedDeckId = () => {
  if (typeof window === "undefined") return defaultDeckId;
  const saved = window.localStorage.getItem(SELECTED_DECK_STORAGE_KEY) ?? defaultDeckId;
  return cachedSanitizeResult?.deckIdMap.get(saved) ?? saved;
};

export const loadSyncKey = (
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
  buildSyncKey = getBuildSyncKey(BUILD_SYNC_KEY),
) => {
  const saved = storage?.getItem(SYNC_KEY_STORAGE_KEY) ?? "";

  if (isSyncKeyValid(saved)) {
    return saved.trim();
  }

  if (buildSyncKey) {
    return buildSyncKey;
  }

  const generated = createSyncKey();
  storage?.setItem(SYNC_KEY_STORAGE_KEY, generated);
  return generated;
};

export const loadPinnedDeckIds = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(PINNED_DECKS_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    const deckIdMap = cachedSanitizeResult?.deckIdMap;
    return deckIdMap ? parsed.map((id) => deckIdMap.get(id) ?? id) : parsed;
  } catch {
    return [];
  }
};

export const loadRecentDeckIds = (): RecentDeckEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(RECENT_DECKS_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    const deckIdMap = cachedSanitizeResult?.deckIdMap;
    return deckIdMap
      ? parsed.map((entry) => ({ ...entry, id: deckIdMap.get(entry.id) ?? entry.id }))
      : parsed;
  } catch {
    return [];
  }
};
