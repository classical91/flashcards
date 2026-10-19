import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toDateKey } from "../dailyCard";
import { isCanonicalDateKey } from "../../../server-daily-card.mjs";

// Main Hub's Daily Dashboard asks for the Card of the Day in Vancouver time —
// its server pins TZ to America/Vancouver and formats the day exactly as
// toDateKey does. A Flashcards tab in Vancouver must land on the same day key
// at the same instant, or the two would ask the server about different days.
// Node re-reads TZ when it changes, which is how Main Hub sets it too.

const previousTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Vancouver";
});

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe("Card of the Day dates in Vancouver", () => {
  it("turns over at Vancouver's midnight, not UTC's", () => {
    // 23:59 PDT on Oct 19 is already 06:59 UTC on Oct 20.
    expect(toDateKey(new Date("2026-10-20T06:59:00Z"))).toBe("2026-10-19");
    expect(toDateKey(new Date("2026-10-20T07:00:00Z"))).toBe("2026-10-20");
  });

  it("keeps the right day across the spring-forward change", () => {
    // Clocks jump 02:00 -> 03:00 PST->PDT on 2026-03-08; midnight is UTC-8
    // before it and the next midnight is UTC-7.
    expect(toDateKey(new Date("2026-03-08T07:59:00Z"))).toBe("2026-03-07");
    expect(toDateKey(new Date("2026-03-08T08:00:00Z"))).toBe("2026-03-08");
    expect(toDateKey(new Date("2026-03-09T06:59:00Z"))).toBe("2026-03-08");
    expect(toDateKey(new Date("2026-03-09T07:00:00Z"))).toBe("2026-03-09");
  });

  it("keeps the right day across the fall-back change", () => {
    // Clocks fall 02:00 -> 01:00 PDT->PST on 2026-11-01, a 25-hour day.
    expect(toDateKey(new Date("2026-11-01T06:59:00Z"))).toBe("2026-10-31");
    expect(toDateKey(new Date("2026-11-01T07:00:00Z"))).toBe("2026-11-01");
    expect(toDateKey(new Date("2026-11-02T07:59:00Z"))).toBe("2026-11-01");
    expect(toDateKey(new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
  });

  it("always asks about a day the server keeps a canonical pick for", () => {
    for (const instant of [
      "2026-03-08T07:59:00Z",
      "2026-03-09T07:00:00Z",
      "2026-11-01T06:59:00Z",
      "2026-11-02T07:59:00Z",
      "2026-10-20T06:59:00Z",
    ]) {
      const now = new Date(instant);
      expect(isCanonicalDateKey(toDateKey(now), now)).toBe(true);
    }
  });
});
