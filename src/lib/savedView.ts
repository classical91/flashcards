import { DeckSection } from "../data/deckBuilder";
import { findDeckById } from "./deckUtils";
import { ViewState } from "./types";

/**
 * The screen you are on, kept across a reload.
 *
 * It lives in sessionStorage rather than localStorage: a refresh (or the
 * browser reloading a backgrounded tab) puts you back where you were, while a
 * fresh visit still starts on the library.
 */
export const SAVED_VIEW_STORAGE_KEY = "flashcards.view.v1";

/**
 * Reads a saved view back, or home when there is none or it no longer points
 * at anything in this library — a topic or deck deleted since is not a place
 * to land.
 */
export const parseSavedView = (raw: string | null, sections: DeckSection[]): ViewState => {
  if (!raw) return { kind: "home" };
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { kind: "home" };
  }
  if (!saved || typeof saved !== "object") return { kind: "home" };
  const view = saved as Partial<Record<string, unknown>>;

  if (view.kind === "pinned") return { kind: "pinned" };
  if (view.kind === "section" && typeof view.sectionId === "string") {
    const sectionId = view.sectionId;
    return sections.some((section) => section.id === sectionId)
      ? { kind: "section", sectionId }
      : { kind: "home" };
  }
  if (view.kind === "study" && typeof view.deckId === "string") {
    return findDeckById(sections, view.deckId)
      ? { kind: "study", deckId: view.deckId }
      : { kind: "home" };
  }
  return { kind: "home" };
};

export const loadSavedView = (sections: DeckSection[]): ViewState => {
  try {
    return parseSavedView(window.sessionStorage.getItem(SAVED_VIEW_STORAGE_KEY), sections);
  } catch {
    return { kind: "home" };
  }
};

export const saveView = (view: ViewState) => {
  try {
    window.sessionStorage.setItem(SAVED_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {}
};
