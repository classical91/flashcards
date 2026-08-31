/**
 * Scheduling for the review queue.
 *
 * The algorithm is SM-2 with short learning steps — the same family Anki and
 * most flashcard apps use. FSRS schedules a little better but needs a trained
 * weight set and a review history to train it on; SM-2 needs neither, is
 * simple enough to reason about, and every rule here is testable.
 *
 * Intervals are stored in days and due dates in epoch ms, so a card scheduled
 * on one device is due at the same moment on every other one.
 */

export type ReviewGrade = "again" | "hard" | "good" | "easy";

export type ReviewState = {
  /** When the card comes back, epoch ms. */
  due: number;
  /** Current spacing in days. Sub-day learning steps are stored as fractions. */
  interval: number;
  /** SM-2 ease factor: how fast the interval grows once a card is learned. */
  ease: number;
  /** Successful reviews in a row. Reset to 0 by "again". */
  reps: number;
  /** How many times a learned card has been forgotten. */
  lapses: number;
  lastReviewedAt: number;
};

export const REVIEW_GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 2.7;

/** Sub-day steps for a card that is still being learned, in days. */
const AGAIN_STEP = (10 * MINUTE) / DAY;
const FIRST_GOOD_INTERVAL = 1;
const SECOND_GOOD_INTERVAL = 3;
/** Keeps one "easy" from launching a new card months into the future. */
const EASY_BONUS = 1.3;
const HARD_MULTIPLIER = 1.2;
const MAX_INTERVAL = 365;

const clampEase = (ease: number) => Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
const clampInterval = (interval: number) => Math.min(MAX_INTERVAL, interval);

const EASE_DELTA: Record<ReviewGrade, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

const nextInterval = (grade: ReviewGrade, previous: ReviewState | undefined) => {
  const reps = previous?.reps ?? 0;
  const interval = previous?.interval ?? 0;
  const ease = previous?.ease ?? DEFAULT_EASE;

  if (grade === "again") return AGAIN_STEP;
  // A card that has never been answered correctly has no interval to grow, so
  // the first two successes use fixed steps rather than the ease factor.
  if (reps === 0) return grade === "easy" ? SECOND_GOOD_INTERVAL : FIRST_GOOD_INTERVAL;
  if (reps === 1) return grade === "hard" ? FIRST_GOOD_INTERVAL : SECOND_GOOD_INTERVAL;
  if (grade === "hard") return interval * HARD_MULTIPLIER;
  if (grade === "easy") return interval * ease * EASY_BONUS;
  return interval * ease;
};

/**
 * Applies a grade to a card. `previous` is undefined the first time a card is
 * reviewed. Never mutates its input.
 */
export const gradeCard = (
  grade: ReviewGrade,
  previous: ReviewState | undefined,
  now = Date.now(),
): ReviewState => {
  const interval = clampInterval(nextInterval(grade, previous));
  const wasLearned = (previous?.reps ?? 0) > 0;

  return {
    due: now + Math.round(interval * DAY),
    interval,
    ease: clampEase((previous?.ease ?? DEFAULT_EASE) + EASE_DELTA[grade]),
    reps: grade === "again" ? 0 : (previous?.reps ?? 0) + 1,
    lapses: (previous?.lapses ?? 0) + (grade === "again" && wasLearned ? 1 : 0),
    lastReviewedAt: now,
  };
};

/** The last millisecond of the local day `now` falls in. */
export const endOfLocalDay = (now = Date.now()) => {
  const date = new Date(now);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
};

export const isDue = (state: ReviewState | undefined, now = Date.now()) =>
  state !== undefined && state.due <= now;

/**
 * Counts what a deck has waiting.
 *
 * "Due" is measured against the end of the local day rather than this instant,
 * so a card scheduled for later this evening is already part of today's work
 * instead of appearing out of nowhere at 9pm. A card that has never been
 * graded is counted as new, not due — otherwise every card in a fresh library
 * would be reported as overdue.
 */
export const countReviewQueue = (
  cardIds: string[],
  reviews: Record<string, ReviewState> | undefined,
  now = Date.now(),
) => {
  const cutoff = endOfLocalDay(now);
  let due = 0;
  let newCards = 0;
  cardIds.forEach((cardId) => {
    const state = reviews?.[cardId];
    if (!state) newCards += 1;
    else if (state.due <= cutoff) due += 1;
  });
  return { due, newCards };
};

/**
 * The cards to work through: everything already due, oldest first, then cards
 * that have never been graded in the deck's own order.
 */
export const buildReviewQueue = <T extends { id: string }>(
  cards: T[],
  reviews: Record<string, ReviewState> | undefined,
  now = Date.now(),
) => {
  const cutoff = endOfLocalDay(now);
  const dueCards: { card: T; due: number }[] = [];
  const newCards: T[] = [];

  cards.forEach((card) => {
    const state = reviews?.[card.id];
    if (!state) newCards.push(card);
    else if (state.due <= cutoff) dueCards.push({ card, due: state.due });
  });

  return [...dueCards.sort((a, b) => a.due - b.due).map((entry) => entry.card), ...newCards];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseReviewState = (value: unknown): ReviewState | null => {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.due) ||
    !isFiniteNumber(value.interval) ||
    !isFiniteNumber(value.ease) ||
    !isFiniteNumber(value.reps) ||
    !isFiniteNumber(value.lapses) ||
    !isFiniteNumber(value.lastReviewedAt)
  ) {
    return null;
  }

  return {
    due: value.due,
    interval: value.interval,
    ease: clampEase(value.ease),
    reps: Math.max(0, Math.trunc(value.reps)),
    lapses: Math.max(0, Math.trunc(value.lapses)),
    lastReviewedAt: value.lastReviewedAt,
  };
};

/**
 * Drops unreadable entries rather than rejecting the whole library: one
 * corrupt schedule should cost that card its history, not strand every deck
 * on the device that wrote it.
 */
export const parseReviews = (value: unknown): Record<string, ReviewState> => {
  if (!isRecord(value)) return {};
  const reviews: Record<string, ReviewState> = {};
  Object.entries(value).forEach(([cardId, state]) => {
    const parsed = parseReviewState(state);
    if (parsed) reviews[cardId] = parsed;
  });
  return reviews;
};

/** Human-readable spacing for the grade buttons, e.g. "10m", "3d", "2.5mo". */
export const formatInterval = (days: number) => {
  if (days < 1) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    return `${minutes}m`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(days < 60 ? 1 : 0)}mo`;
  return `${(days / 365).toFixed(1)}y`;
};

/** What each button would schedule, for the labels under the grade buttons. */
export const previewIntervals = (previous: ReviewState | undefined) =>
  Object.fromEntries(
    REVIEW_GRADES.map((grade) => [
      grade,
      formatInterval(clampInterval(nextInterval(grade, previous))),
    ]),
  ) as Record<ReviewGrade, string>;
