import { describe, it, expect } from "vitest";
import {
  parseLibrarySnapshot,
  createLibrarySnapshot,
  parseLibrarySections,
} from "../librarySnapshot";
import type { LibrarySnapshot } from "../librarySnapshot";

const validSnapshot = (): LibrarySnapshot =>
  createLibrarySnapshot({
    librarySections: [
      {
        id: "test-section",
        title: "Test",
        description: "A test section",
        decks: [
          {
            id: "test-deck",
            title: "Test Deck",
            subtitle: "A test deck",
            cards: [{ id: "card-1", term: "hello", definition: "a greeting" }],
          },
        ],
      },
    ],
    deckProgress: {
      "test-deck": {
        currentCardId: "card-1",
        knownIds: [],
        isFlipped: false,
        studyMode: "all",
      },
    },
    selectedDeckId: "test-deck",
  });

/** A snapshot as written by the client before tombstones and preference sync. */
const v1Snapshot = () => {
  const { tombstones: _t, preferences: _p, ...rest } = validSnapshot();
  return { ...rest, version: 1 as const, recentDeckIds: [] as string[] };
};

describe("parseLibrarySnapshot", () => {
  it("parses a valid snapshot round-trip", () => {
    const snapshot = validSnapshot();
    const result = parseLibrarySnapshot(snapshot);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);
    expect(result?.librarySections).toHaveLength(1);
    expect(result?.selectedDeckId).toBe("test-deck");
    expect(result?.deckProgress["test-deck"].studyMode).toBe("all");
  });

  it("returns null for null input", () => {
    expect(parseLibrarySnapshot(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseLibrarySnapshot(undefined)).toBeNull();
  });

  it("returns null for a string", () => {
    expect(parseLibrarySnapshot("not a snapshot")).toBeNull();
  });

  it("returns null for an array", () => {
    expect(parseLibrarySnapshot([])).toBeNull();
  });

  it("returns null for an unknown version number", () => {
    const snapshot = { ...validSnapshot(), version: 3 as unknown as 2 };
    expect(parseLibrarySnapshot(snapshot)).toBeNull();
  });

  it("upgrades a version 1 snapshot instead of rejecting it", () => {
    const result = parseLibrarySnapshot(v1Snapshot());
    expect(result?.version).toBe(2);
    expect(result?.tombstones).toEqual({ sections: {}, decks: {}, cards: {} });
    // Zero so an upgraded library never outranks a device that has actually
    // chosen a theme or pinned something.
    expect(result?.preferences.updatedAt).toBe(0);
  });

  it("returns null when librarySections is missing", () => {
    const { librarySections: _, ...rest } = validSnapshot();
    expect(parseLibrarySnapshot(rest)).toBeNull();
  });

  it("returns null when librarySections is not an array", () => {
    expect(parseLibrarySnapshot({ ...validSnapshot(), librarySections: "bad" })).toBeNull();
  });

  it("returns null when a card is missing the term field", () => {
    const snapshot = validSnapshot();
    (snapshot.librarySections[0].decks[0].cards[0] as Record<string, unknown>).term = undefined;
    expect(parseLibrarySnapshot(snapshot)).toBeNull();
  });

  it("returns null when a card is missing the definition field", () => {
    const snapshot = validSnapshot();
    (snapshot.librarySections[0].decks[0].cards[0] as Record<string, unknown>).definition =
      undefined;
    expect(parseLibrarySnapshot(snapshot)).toBeNull();
  });

  it("returns null when studyMode is an invalid value", () => {
    const snapshot = validSnapshot();
    (snapshot.deckProgress["test-deck"] as Record<string, unknown>).studyMode = "invalid";
    expect(parseLibrarySnapshot(snapshot)).toBeNull();
  });

  it("returns null when knownIds contains a non-string value", () => {
    const snapshot = validSnapshot();
    (snapshot.deckProgress["test-deck"].knownIds as unknown[]).push(42);
    expect(parseLibrarySnapshot(snapshot)).toBeNull();
  });

  it("returns null when isFlipped is not a boolean", () => {
    const snapshot = validSnapshot();
    (snapshot.deckProgress["test-deck"] as Record<string, unknown>).isFlipped = "yes";
    expect(parseLibrarySnapshot(snapshot)).toBeNull();
  });

  it("returns null when deckProgress is not a plain object", () => {
    expect(parseLibrarySnapshot({ ...validSnapshot(), deckProgress: [] })).toBeNull();
  });

  it("deduplicates a version 1 snapshot's recentDeckIds", () => {
    const snapshot = { ...v1Snapshot(), recentDeckIds: ["a", "b", "a"] };
    const result = parseLibrarySnapshot(snapshot);
    expect(result?.recentDeckIds).toEqual(["a", "b"]);
  });

  it("accepts snapshot without recentDeckIds and defaults to []", () => {
    const { recentDeckIds: _, ...rest } = v1Snapshot();
    const result = parseLibrarySnapshot(rest);
    expect(result).not.toBeNull();
    expect(result?.recentDeckIds).toEqual([]);
  });

  it("falls back to [] when recentDeckIds contains a non-string value", () => {
    const snapshot = { ...v1Snapshot(), recentDeckIds: ["a", 1] };
    const result = parseLibrarySnapshot(snapshot);
    expect(result).not.toBeNull();
    expect(result?.recentDeckIds).toEqual([]);
  });

  it("keeps a version 2 snapshot's timestamped recents over the flat list", () => {
    const snapshot = {
      ...validSnapshot(),
      recentDeckIds: ["stale"],
      preferences: {
        ...validSnapshot().preferences,
        recentDecks: [{ id: "test-deck", viewedAt: 42 }],
      },
    };
    const result = parseLibrarySnapshot(snapshot);
    expect(result?.preferences.recentDecks).toEqual([{ id: "test-deck", viewedAt: 42 }]);
    expect(result?.recentDeckIds).toEqual(["test-deck"]);
  });

  it("preserves multiple sections and decks", () => {
    const snapshot = validSnapshot();
    snapshot.librarySections.push({
      id: "section-2",
      title: "Section 2",
      description: "Second section",
      decks: [],
    });
    const result = parseLibrarySnapshot(snapshot);
    expect(result?.librarySections).toHaveLength(2);
  });

  it("repairs an oversized deck id from a legacy cloud snapshot and remaps dependent state", () => {
    const longDeckId = "deck-".repeat(40);
    const snapshot = validSnapshot();
    snapshot.librarySections[0].decks[0].id = longDeckId;
    snapshot.librarySections[0].decks[0].cards[0].id = longDeckId;
    snapshot.deckProgress = {
      [longDeckId]: {
        currentCardId: longDeckId,
        knownIds: [longDeckId],
        isFlipped: false,
        studyMode: "all",
      },
    };
    snapshot.selectedDeckId = longDeckId;
    snapshot.preferences = {
      ...snapshot.preferences,
      pinnedDeckIds: [longDeckId],
      recentDecks: [{ id: longDeckId, viewedAt: 1 }],
      deckLastViewed: { [longDeckId]: 1 },
    };
    snapshot.tombstones = { sections: {}, decks: { "gone-deck": 5 }, cards: {} };

    const result = parseLibrarySnapshot(snapshot);
    expect(result).not.toBeNull();
    const repairedDeckId = result?.librarySections[0].decks[0].id ?? "";
    expect(repairedDeckId.length).toBeLessThanOrEqual(120);
    expect(repairedDeckId).not.toBe(longDeckId);
    expect(result?.selectedDeckId).toBe(repairedDeckId);
    expect(result?.recentDeckIds).toEqual([repairedDeckId]);
    expect(result?.preferences.pinnedDeckIds).toEqual([repairedDeckId]);
    expect(Object.keys(result?.preferences.deckLastViewed ?? {})).toEqual([repairedDeckId]);
    expect(Object.keys(result?.deckProgress ?? {})).toEqual([repairedDeckId]);
    expect(result?.deckProgress[repairedDeckId].knownIds).toEqual([
      result?.librarySections[0].decks[0].cards[0].id,
    ]);
  });
});

describe("createLibrarySnapshot", () => {
  it("repairs oversized ids before they're sent to the server", () => {
    const longDeckId = "deck-".repeat(40);
    const snapshot = createLibrarySnapshot({
      librarySections: [
        {
          id: "section",
          title: "Section",
          description: "",
          decks: [
            {
              id: longDeckId,
              title: "Deck",
              subtitle: "",
              cards: [{ id: "card-1", term: "term", definition: "def" }],
            },
          ],
        },
      ],
      deckProgress: {
        [longDeckId]: {
          currentCardId: "card-1",
          knownIds: [],
          isFlipped: false,
          studyMode: "all",
        },
      },
      selectedDeckId: longDeckId,
      preferences: {
        pinnedDeckIds: [],
        recentDecks: [{ id: longDeckId, viewedAt: 1 }],
        deckLastViewed: {},
        theme: "light",
        accentColor: "blue",
        updatedAt: 1,
      },
    });

    const repairedDeckId = snapshot.librarySections[0].decks[0].id;
    expect(repairedDeckId.length).toBeLessThanOrEqual(120);
    expect(snapshot.selectedDeckId).toBe(repairedDeckId);
    expect(snapshot.recentDeckIds).toEqual([repairedDeckId]);
    expect(Object.keys(snapshot.deckProgress)).toEqual([repairedDeckId]);
  });
});

describe("parseLibrarySections", () => {
  it("parses valid library sections for local storage", () => {
    const sections = validSnapshot().librarySections;

    expect(parseLibrarySections(sections)).toEqual(sections);
  });

  it("normalizes older local storage decks missing subtitle", () => {
    const sections = validSnapshot().librarySections;
    const { subtitle: _, ...deckWithoutSubtitle } = sections[0].decks[0];
    const malformed = [
      {
        ...sections[0],
        decks: [deckWithoutSubtitle],
      },
    ];

    expect(parseLibrarySections(malformed)?.[0].decks[0].subtitle).toBe("");
  });

  it("normalizes older local storage sections missing description", () => {
    const sections = validSnapshot().librarySections;
    const { description: _, ...sectionWithoutDescription } = sections[0];

    expect(parseLibrarySections([sectionWithoutDescription])?.[0].description).toBe("");
  });

  it("returns null when local storage card fields are malformed", () => {
    const sections = validSnapshot().librarySections;
    const malformed = [
      {
        ...sections[0],
        decks: [
          {
            ...sections[0].decks[0],
            cards: [{ id: "card-1", term: "hello", definition: 42 }],
          },
        ],
      },
    ];

    expect(parseLibrarySections(malformed)).toBeNull();
  });
});
