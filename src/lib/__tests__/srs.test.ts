import { describe, expect, it } from "vitest";
import {
  DEFAULT_EASE,
  ReviewState,
  buildReviewQueue,
  countReviewQueue,
  endOfLocalDay,
  formatInterval,
  gradeCard,
  isDue,
  parseReviews,
  previewIntervals,
} from "../srs";

const NOW = new Date(2026, 7, 31, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const days = (state: ReviewState) => Math.round(((state.due - NOW) / DAY) * 100) / 100;

describe("gradeCard", () => {
  it("schedules a brand new card a day out on Good", () => {
    const state = gradeCard("good", undefined, NOW);
    expect(days(state)).toBe(1);
    expect(state.reps).toBe(1);
    expect(state.lapses).toBe(0);
    expect(state.ease).toBe(DEFAULT_EASE);
  });

  it("gives a brand new card a longer first step on Easy", () => {
    expect(days(gradeCard("easy", undefined, NOW))).toBe(3);
  });

  it("brings a card straight back on Again", () => {
    const state = gradeCard("again", undefined, NOW);
    expect(state.due - NOW).toBe(10 * 60 * 1000);
    expect(state.reps).toBe(0);
  });

  it("grows the interval by the ease factor once a card is learned", () => {
    const learned: ReviewState = {
      due: NOW,
      interval: 10,
      ease: 2.5,
      reps: 4,
      lapses: 0,
      lastReviewedAt: NOW - DAY,
    };
    expect(days(gradeCard("good", learned, NOW))).toBe(25);
  });

  it("grows less on Hard and more on Easy", () => {
    const learned: ReviewState = {
      due: NOW,
      interval: 10,
      ease: 2.5,
      reps: 4,
      lapses: 0,
      lastReviewedAt: NOW - DAY,
    };
    expect(days(gradeCard("hard", learned, NOW))).toBe(12);
    expect(days(gradeCard("easy", learned, NOW))).toBe(32.5);
  });

  it("lowers the ease on Again and Hard, raises it on Easy", () => {
    const learned: ReviewState = {
      due: NOW,
      interval: 10,
      ease: 2.5,
      reps: 4,
      lapses: 0,
      lastReviewedAt: NOW,
    };
    expect(gradeCard("again", learned, NOW).ease).toBeCloseTo(2.3);
    expect(gradeCard("hard", learned, NOW).ease).toBeCloseTo(2.35);
    expect(gradeCard("good", learned, NOW).ease).toBeCloseTo(2.5);
    expect(gradeCard("easy", learned, NOW).ease).toBeCloseTo(2.65);
  });

  it("keeps the ease inside its bounds however often a card is failed or aced", () => {
    let state = gradeCard("good", undefined, NOW);
    for (let index = 0; index < 20; index += 1) state = gradeCard("again", state, NOW);
    expect(state.ease).toBe(1.3);

    for (let index = 0; index < 20; index += 1) state = gradeCard("easy", state, NOW);
    expect(state.ease).toBe(2.7);
  });

  it("counts a lapse only when a learned card is forgotten", () => {
    const fresh = gradeCard("again", undefined, NOW);
    expect(fresh.lapses).toBe(0);

    const learned = gradeCard("good", gradeCard("good", undefined, NOW), NOW);
    expect(gradeCard("again", learned, NOW).lapses).toBe(1);
  });

  it("caps the interval at a year", () => {
    const veryLong: ReviewState = {
      due: NOW,
      interval: 400,
      ease: 2.5,
      reps: 20,
      lapses: 0,
      lastReviewedAt: NOW,
    };
    expect(days(gradeCard("easy", veryLong, NOW))).toBe(365);
  });

  it("does not mutate the state it was given", () => {
    const previous: ReviewState = {
      due: NOW,
      interval: 10,
      ease: 2.5,
      reps: 4,
      lapses: 0,
      lastReviewedAt: NOW,
    };
    const copy = { ...previous };
    gradeCard("good", previous, NOW);
    expect(previous).toEqual(copy);
  });
});

describe("the review queue", () => {
  const state = (due: number): ReviewState => ({
    due,
    interval: 1,
    ease: 2.5,
    reps: 1,
    lapses: 0,
    lastReviewedAt: NOW - DAY,
  });

  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("counts an ungraded card as new rather than overdue", () => {
    expect(countReviewQueue(["a", "b"], {}, NOW)).toEqual({ due: 0, newCards: 2 });
  });

  it("counts a card due later today as due now", () => {
    const laterToday = endOfLocalDay(NOW) - 1000;
    expect(countReviewQueue(["a"], { a: state(laterToday) }, NOW)).toEqual({ due: 1, newCards: 0 });
  });

  it("does not count a card due tomorrow", () => {
    expect(countReviewQueue(["a"], { a: state(NOW + DAY) }, NOW)).toEqual({ due: 0, newCards: 0 });
  });

  it("puts the most overdue card first and never-graded cards last", () => {
    const reviews = {
      a: state(NOW - DAY),
      c: state(NOW - 3 * DAY),
      d: state(NOW + 5 * DAY),
    };
    expect(buildReviewQueue(cards, reviews, NOW).map((card) => card.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps a card graded Again in today's queue", () => {
    const graded = gradeCard("again", undefined, NOW);
    expect(buildReviewQueue([{ id: "a" }], { a: graded }, NOW).map((c) => c.id)).toEqual(["a"]);
  });

  it("drops a card graded Good out of today's queue", () => {
    const graded = gradeCard("good", undefined, NOW);
    expect(buildReviewQueue([{ id: "a" }], { a: graded }, NOW)).toEqual([]);
  });

  it("treats a missing reviews map as an all-new deck", () => {
    expect(buildReviewQueue(cards, undefined, NOW).map((card) => card.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("isDue", () => {
  it("is false for a card that has never been graded", () => {
    expect(isDue(undefined, NOW)).toBe(false);
  });

  it("is true at the exact due moment", () => {
    expect(
      isDue({ due: NOW, interval: 1, ease: 2.5, reps: 1, lapses: 0, lastReviewedAt: 0 }, NOW),
    ).toBe(true);
  });
});

describe("parseReviews", () => {
  it("keeps well-formed entries", () => {
    const reviews = {
      a: { due: 1, interval: 2, ease: 2.5, reps: 3, lapses: 0, lastReviewedAt: 4 },
    };
    expect(parseReviews(reviews)).toEqual(reviews);
  });

  it("drops a corrupt entry instead of losing the whole map", () => {
    const parsed = parseReviews({
      a: { due: 1, interval: 2, ease: 2.5, reps: 3, lapses: 0, lastReviewedAt: 4 },
      b: { due: "soon" },
      c: null,
    });
    expect(Object.keys(parsed)).toEqual(["a"]);
  });

  it("returns an empty map for anything that isn't an object", () => {
    expect(parseReviews(undefined)).toEqual({});
    expect(parseReviews([])).toEqual({});
  });

  it("clamps a stored ease that is out of range", () => {
    const parsed = parseReviews({
      a: { due: 1, interval: 2, ease: 99, reps: 3, lapses: 0, lastReviewedAt: 4 },
    });
    expect(parsed.a.ease).toBe(2.7);
  });
});

describe("formatInterval", () => {
  it("shows sub-day steps in minutes", () => {
    expect(formatInterval(10 / (24 * 60))).toBe("10m");
  });

  it("shows days, months and years as the interval grows", () => {
    expect(formatInterval(3)).toBe("3d");
    expect(formatInterval(45)).toBe("1.5mo");
    expect(formatInterval(180)).toBe("6mo");
    expect(formatInterval(730)).toBe("2.0y");
  });
});

describe("previewIntervals", () => {
  it("labels every button for a card that has never been graded", () => {
    expect(previewIntervals(undefined)).toEqual({
      again: "10m",
      hard: "1d",
      good: "1d",
      easy: "3d",
    });
  });

  it("matches what grading would actually schedule", () => {
    const learned: ReviewState = {
      due: NOW,
      interval: 10,
      ease: 2.5,
      reps: 4,
      lapses: 0,
      lastReviewedAt: NOW,
    };
    expect(previewIntervals(learned).good).toBe(formatInterval(25));
    expect(days(gradeCard("good", learned, NOW))).toBe(25);
  });
});
