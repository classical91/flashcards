import { useEffect, useRef } from "react";
import { isTypingTarget } from "../lib/format";
import { REVIEW_GRADES, ReviewGrade } from "../lib/srs";

export type StudyKeyboardHandlers = {
  onFlip: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleKnown: () => void;
  onShuffle: () => void;
  /** Only called while a review session is running; 1-4 grade the card. */
  onGrade: ((grade: ReviewGrade) => void) | null;
};

/**
 * Registers global keyboard shortcuts for the study view.
 *
 * The listener is registered only when `active` changes (i.e. once per study
 * session), not on every render. Handlers are read through a ref so they always
 * see the latest closure without forcing the effect to re-run.
 */
export function useStudyKeyboard(active: boolean, handlers: StudyKeyboardHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const current = handlersRef.current;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        current.onFlip();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        current.onNext();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        current.onPrev();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        current.onToggleKnown();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        current.onShuffle();
      }
      if (current.onGrade && event.key >= "1" && event.key <= "4") {
        event.preventDefault();
        current.onGrade(REVIEW_GRADES[Number(event.key) - 1]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);
}
