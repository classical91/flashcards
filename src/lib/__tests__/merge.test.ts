import { describe, expect, it } from "vitest";
import { Deck, DeckSection } from "../../data/deckBuilder";
import { DeckProgress, SyncedPreferences, defaultPreferences } from "../../data/librarySnapshot";
import { LibraryState, mergeLibraryState } from "../merge";
import {
  TOMBSTONE_TTL_MS,
  Tombstones,
  cardTombstoneKey,
  emptyTombstones,
  recordCardDeletion,
  recordDeckDeletion,
  recordSectionDeletion,
} from "../tombstones";

const NOW = 1_700_000_000_000;

const card = (id: string, updatedAt?: number) => ({
  id,
  term: id,
  definition: `${id} definition`,
  ...(updatedAt === undefined ? {} : { updatedAt }),
});

const deck = (id: string, cardIds: string[], updatedAt?: number): Deck => ({
  id,
  title: id,
  subtitle: "",
  cards: cardIds.map((cardId) => card(cardId)),
  ...(updatedAt === undefined ? {} : { updatedAt }),
});

const section = (id: string, decks: Deck[], updatedAt?: number): DeckSection => ({
  id,
  title: id,
  description: "",
  decks,
  ...(updatedAt === undefined ? {} : { updatedAt }),
});

const progress = (overrides: Partial<DeckProgress> = {}): DeckProgress => ({
  currentCardId: "",
  knownIds: [],
  isFlipped: false,
  studyMode: "all",
  reviews: {},
  ...overrides,
});

const state = (overrides: Partial<LibraryState> = {}): LibraryState => ({
  librarySections: [],
  deckProgress: {},
  tombstones: emptyTombstones(),
  preferences: defaultPreferences(),
  ...overrides,
});

const prefs = (overrides: Partial<SyncedPreferences> = {}): SyncedPreferences => ({
  ...defaultPreferences(),
  ...overrides,
});

const deckIds = (sections: DeckSection[]) => sections.flatMap((s) => s.decks.map((d) => d.id));
const cardIds = (sections: DeckSection[], deckId: string) =>
  sections
    .flatMap((s) => s.decks)
    .find((d) => d.id === deckId)
    ?.cards.map((c) => c.id) ?? [];

describe("mergeLibraryState — deletions", () => {
  it("keeps a deck deleted on this device even though the cloud still has it", () => {
    const local = state({
      librarySections: [section("topic", [])],
      tombstones: recordDeckDeletion(emptyTombstones(), "gone", NOW),
    });
    const remote = state({ librarySections: [section("topic", [deck("gone", ["c1"])])] });

    expect(deckIds(mergeLibraryState(local, remote, NOW).librarySections)).toEqual([]);
  });

  it("drops a deck the cloud deleted while this device still had it", () => {
    const local = state({ librarySections: [section("topic", [deck("gone", ["c1"])])] });
    const remote = state({
      librarySections: [section("topic", [])],
      tombstones: recordDeckDeletion(emptyTombstones(), "gone", NOW),
    });

    expect(deckIds(mergeLibraryState(local, remote, NOW).librarySections)).toEqual([]);
  });

  it("drops a deleted card without touching its siblings", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "c"])])],
      tombstones: recordCardDeletion(emptyTombstones(), "d1", "b", NOW),
    });
    const remote = state({ librarySections: [section("topic", [deck("d1", ["a", "b", "c"])])] });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(cardIds(merged.librarySections, "d1")).toEqual(["a", "c"]);
  });

  it("removes a deleted topic and everything under it", () => {
    const local = state({
      librarySections: [],
      tombstones: recordSectionDeletion(emptyTombstones(), "topic", NOW),
    });
    const remote = state({ librarySections: [section("topic", [deck("d1", ["a"])])] });

    expect(mergeLibraryState(local, remote, NOW).librarySections).toEqual([]);
  });

  it("keeps an entity that was re-created after the delete", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"], NOW + 1000)])],
      tombstones: recordDeckDeletion(emptyTombstones(), "d1", NOW),
    });
    const remote = state();

    expect(deckIds(mergeLibraryState(local, remote, NOW).librarySections)).toEqual(["d1"]);
  });

  it("forgets tombstones once they are past their expiry", () => {
    const expired = NOW - TOMBSTONE_TTL_MS - 1;
    const local = state({
      librarySections: [],
      tombstones: recordDeckDeletion(emptyTombstones(), "old", expired),
    });
    const remote = state({ librarySections: [section("topic", [deck("old", ["a"])])] });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(merged.tombstones.decks).toEqual({});
    expect(deckIds(merged.librarySections)).toEqual(["old"]);
  });

  it("carries both sides' tombstones forward so a third device also learns of them", () => {
    const local = state({ tombstones: recordDeckDeletion(emptyTombstones(), "a", NOW) });
    const remote = state({ tombstones: recordDeckDeletion(emptyTombstones(), "b", NOW) });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(merged.tombstones.decks).toEqual({ a: NOW, b: NOW });
  });
});

describe("mergeLibraryState — simultaneous edits", () => {
  it("keeps the newer of two edits to the same card", () => {
    const local = state({
      librarySections: [
        section("topic", [
          { ...deck("d1", []), cards: [{ ...card("c1", NOW), definition: "local wins" }] },
        ]),
      ],
    });
    const remote = state({
      librarySections: [
        section("topic", [
          { ...deck("d1", []), cards: [{ ...card("c1", NOW - 1), definition: "older" }] },
        ]),
      ],
    });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(merged.librarySections[0].decks[0].cards[0].definition).toBe("local wins");
  });

  it("takes the cloud's newer deck rename", () => {
    const local = state({ librarySections: [section("topic", [deck("d1", ["a"], NOW - 5)])] });
    const remote = state({
      librarySections: [section("topic", [{ ...deck("d1", ["a"], NOW), title: "Renamed" }])],
    });

    expect(mergeLibraryState(local, remote, NOW).librarySections[0].decks[0].title).toBe("Renamed");
  });

  it("unions cards each side added independently", () => {
    const local = state({ librarySections: [section("topic", [deck("d1", ["a", "b"])])] });
    const remote = state({ librarySections: [section("topic", [deck("d1", ["a", "c"])])] });

    expect(cardIds(mergeLibraryState(local, remote, NOW).librarySections, "d1")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("converges: merging twice gives the same result", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"], NOW)])],
      tombstones: recordCardDeletion(emptyTombstones(), "d1", "c", NOW),
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a", "c"], NOW - 10)])],
    });

    const once = mergeLibraryState(local, remote, NOW);
    expect(mergeLibraryState(once, remote, NOW)).toEqual(once);
  });
});

describe("mergeLibraryState — progress", () => {
  it("does not resurrect a card the user unmarked on the newer device", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: {
        d1: progress({ knownIds: ["a"], knownUpdatedAt: { b: NOW } }),
      },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: {
        d1: progress({ knownIds: ["a", "b"], knownUpdatedAt: { b: NOW - 1 } }),
      },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.knownIds).toEqual(["a"]);
  });

  it("keeps marks made on two devices for different cards", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "b", "c"])])],
      deckProgress: {
        d1: progress({ knownIds: ["a"], knownUpdatedAt: { a: NOW }, positionUpdatedAt: NOW }),
      },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a", "b", "c"])])],
      deckProgress: {
        d1: progress({
          knownIds: ["b"],
          knownUpdatedAt: { b: NOW - 1000 },
          positionUpdatedAt: NOW - 1000,
        }),
      },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.knownIds.sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps an unmark on one device and a mark on another", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: {
        d1: progress({ knownIds: [], knownUpdatedAt: { a: NOW } }),
      },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: {
        d1: progress({ knownIds: ["a", "b"], knownUpdatedAt: { a: NOW - 100, b: NOW - 50 } }),
      },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.knownIds).toEqual(["b"]);
  });

  it("lets an explicit unmark beat a mark from a client too old to stamp it", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"])])],
      deckProgress: { d1: progress({ knownIds: [], knownUpdatedAt: { a: NOW } }) },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a"])])],
      deckProgress: { d1: progress({ knownIds: ["a"] }) },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.knownIds).toEqual([]);
  });

  it("does not let navigating on one device discard a mark from another", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      // This device only moved to another card — much later, but it changed
      // nothing about what is known.
      deckProgress: {
        d1: progress({
          currentCardId: "b",
          positionUpdatedAt: NOW + 60_000,
          updatedAt: NOW + 60_000,
        }),
      },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: {
        d1: progress({ knownIds: ["a"], knownUpdatedAt: { a: NOW }, updatedAt: NOW }),
      },
    });

    const merged = mergeLibraryState(local, remote, NOW).deckProgress.d1;
    expect(merged.knownIds).toEqual(["a"]);
    expect(merged.currentCardId).toBe("b");
  });

  it("never takes the other device's flipped state", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"])])],
      deckProgress: { d1: progress({ isFlipped: false }) },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a"])])],
      deckProgress: { d1: progress({ isFlipped: true, positionUpdatedAt: NOW }) },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.isFlipped).toBe(false);
  });

  it("still unions progress that predates timestamps, so the upgrade loses nothing", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: { d1: progress({ knownIds: ["a"] }) },
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a", "b"])])],
      deckProgress: { d1: progress({ knownIds: ["b"] }) },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.knownIds.sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops known ids for cards that no longer exist", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"])])],
      deckProgress: { d1: progress({ knownIds: ["a", "deleted"], updatedAt: NOW }) },
      tombstones: recordCardDeletion(emptyTombstones(), "d1", "deleted", NOW),
    });
    const remote = state({ librarySections: [section("topic", [deck("d1", ["a", "deleted"])])] });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(merged.deckProgress.d1.knownIds).toEqual(["a"]);
  });

  it("gives a deck with no progress on either side a fresh entry", () => {
    const local = state({ librarySections: [section("topic", [deck("d1", ["a"])])] });
    const merged = mergeLibraryState(local, state(), NOW);
    expect(merged.deckProgress.d1).toEqual(
      progress({ currentCardId: "a", knownUpdatedAt: {}, positionUpdatedAt: 0 }),
    );
  });
});

describe("mergeLibraryState — preferences", () => {
  it("takes the whole pin/theme group from the device that changed it last", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"]), deck("d2", ["b"])])],
      preferences: prefs({ pinnedDeckIds: ["d1"], theme: "light", updatedAt: NOW - 10 }),
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a"]), deck("d2", ["b"])])],
      preferences: prefs({ pinnedDeckIds: ["d2"], theme: "dark", updatedAt: NOW }),
    });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(merged.preferences.pinnedDeckIds).toEqual(["d2"]);
    expect(merged.preferences.theme).toBe("dark");
    expect(merged.preferences.updatedAt).toBe(NOW);
  });

  it("drops a pin for a deck that was deleted", () => {
    const local = state({
      librarySections: [],
      preferences: prefs({ pinnedDeckIds: ["gone"], updatedAt: NOW }),
      tombstones: recordDeckDeletion(emptyTombstones(), "gone", NOW),
    });
    const remote = state({ librarySections: [section("topic", [deck("gone", ["a"])])] });

    expect(mergeLibraryState(local, remote, NOW).preferences.pinnedDeckIds).toEqual([]);
  });

  it("keeps the most recent view time per deck rather than a whole side", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"]), deck("d2", ["b"])])],
      preferences: prefs({ deckLastViewed: { d1: 300, d2: 100 } }),
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a"]), deck("d2", ["b"])])],
      preferences: prefs({ deckLastViewed: { d1: 200, d2: 500 } }),
    });

    expect(mergeLibraryState(local, remote, NOW).preferences.deckLastViewed).toEqual({
      d1: 300,
      d2: 500,
    });
  });

  it("orders merged recents most recent first", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"]), deck("d2", ["b"])])],
      preferences: prefs({ recentDecks: [{ id: "d1", viewedAt: 100 }] }),
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["a"]), deck("d2", ["b"])])],
      preferences: prefs({ recentDecks: [{ id: "d2", viewedAt: 200 }] }),
    });

    expect(mergeLibraryState(local, remote, NOW).preferences.recentDecks).toEqual([
      { id: "d2", viewedAt: 200 },
      { id: "d1", viewedAt: 100 },
    ]);
  });
});

describe("tombstone keys", () => {
  it("scopes a card tombstone to its deck, since card ids repeat across decks", () => {
    const tombstones: Tombstones = recordCardDeletion(emptyTombstones(), "d1", "shared", NOW);
    expect(Object.keys(tombstones.cards)).toEqual([cardTombstoneKey("d1", "shared")]);

    const local = state({
      librarySections: [section("topic", [deck("d1", []), deck("d2", ["shared"])])],
      tombstones,
    });
    const remote = state({
      librarySections: [section("topic", [deck("d1", ["shared"]), deck("d2", ["shared"])])],
    });

    const merged = mergeLibraryState(local, remote, NOW);
    expect(cardIds(merged.librarySections, "d1")).toEqual([]);
    expect(cardIds(merged.librarySections, "d2")).toEqual(["shared"]);
  });
});

describe("mergeLibraryState — review schedules", () => {
  const schedule = (lastReviewedAt: number, due = lastReviewedAt + 86_400_000) => ({
    due,
    interval: 1,
    ease: 2.5,
    reps: 1,
    lapses: 0,
    lastReviewedAt,
  });

  const twoCardDeck = () => [section("topic", [deck("d1", ["a", "b"])])];

  it("keeps grades made on two devices for different cards", () => {
    const local = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { a: schedule(NOW) } }) },
    });
    const remote = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { b: schedule(NOW - 5000) } }) },
    });

    const merged = mergeLibraryState(local, remote, NOW).deckProgress.d1.reviews ?? {};
    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
  });

  it("does not let navigating on one device discard a grade from another", () => {
    const local = state({
      librarySections: twoCardDeck(),
      // Nothing graded here — the user only moved to the next card, later.
      deckProgress: {
        d1: progress({
          currentCardId: "b",
          positionUpdatedAt: NOW + 60_000,
          updatedAt: NOW + 60_000,
        }),
      },
    });
    const remote = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { a: schedule(NOW) }, updatedAt: NOW }) },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.reviews).toEqual({
      a: schedule(NOW),
    });
  });

  it("keeps the later review when both devices graded the same card", () => {
    const local = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { a: schedule(NOW) } }) },
    });
    const remote = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { a: schedule(NOW - 5000) } }) },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.reviews).toEqual({
      a: schedule(NOW),
    });
  });

  it("lets Reset progress clear schedules the other device still holds", () => {
    const local = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ resetAt: NOW }) },
    });
    const remote = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { a: schedule(NOW - 5000) } }) },
    });

    expect(mergeLibraryState(local, remote, NOW).deckProgress.d1.reviews).toEqual({});
  });

  it("keeps a review made after the reset", () => {
    const local = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ resetAt: NOW }) },
    });
    const remote = state({
      librarySections: twoCardDeck(),
      deckProgress: { d1: progress({ reviews: { a: schedule(NOW + 1000) } }) },
    });

    expect(
      Object.keys(mergeLibraryState(local, remote, NOW).deckProgress.d1.reviews ?? {}),
    ).toEqual(["a"]);
  });

  it("drops the schedule of a card that no longer exists", () => {
    const local = state({
      librarySections: [section("topic", [deck("d1", ["a"])])],
      deckProgress: {
        d1: progress({ reviews: { a: schedule(NOW), gone: schedule(NOW) } }),
      },
    });

    expect(
      Object.keys(mergeLibraryState(local, state(), NOW).deckProgress.d1.reviews ?? {}),
    ).toEqual(["a"]);
  });
});

describe("mergeLibraryState — a re-created deck id", () => {
  // Ids are slug-derived, so deleting "Biology" and making a new deck by the
  // same name reuses the id.
  const deleted = NOW;
  const recreated = NOW + 1000;

  const localAfterRecreating = () =>
    state({
      librarySections: [
        section("topic", [
          {
            ...deck("biology", [], recreated),
            cards: [{ ...card("mitosis", recreated) }],
          },
        ]),
      ],
      tombstones: recordDeckDeletion(emptyTombstones(), "biology", deleted),
    });

  const staleDeviceWithOldDeck = () =>
    state({
      librarySections: [
        section("topic", [
          { ...deck("biology", [], deleted - 5000), cards: [{ ...card("photosynthesis") }] },
        ]),
      ],
    });

  it("keeps the new deck", () => {
    const merged = mergeLibraryState(localAfterRecreating(), staleDeviceWithOldDeck(), NOW);
    expect(deckIds(merged.librarySections)).toEqual(["biology"]);
  });

  it("does not let the old deck's cards come back into it", () => {
    const merged = mergeLibraryState(localAfterRecreating(), staleDeviceWithOldDeck(), NOW);
    expect(cardIds(merged.librarySections, "biology")).toEqual(["mitosis"]);
  });

  it("applies the same rule to a re-created topic", () => {
    const local = state({
      librarySections: [section("biology", [deck("cells", ["a"], recreated)], recreated)],
      tombstones: recordSectionDeletion(emptyTombstones(), "biology", deleted),
    });
    const stale = state({
      librarySections: [
        section("biology", [deck("old-deck", ["x"], deleted - 5000)], deleted - 5000),
      ],
    });

    expect(deckIds(mergeLibraryState(local, stale, NOW).librarySections)).toEqual(["cells"]);
  });

  it("still merges normally when the deck was never deleted", () => {
    const local = state({ librarySections: [section("topic", [deck("d1", ["a"])])] });
    const remote = state({ librarySections: [section("topic", [deck("d1", ["b"])])] });

    expect(cardIds(mergeLibraryState(local, remote, NOW).librarySections, "d1")).toEqual([
      "a",
      "b",
    ]);
  });
});
