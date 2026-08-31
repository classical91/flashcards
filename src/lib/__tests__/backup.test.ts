import { describe, expect, it } from "vitest";
import { createLibrarySnapshot, parseLibrarySnapshot } from "../../data/librarySnapshot";
import { buildBackupFileName, countBackupCards, readBackup, serializeBackup } from "../backup";
import { collectEntityIds, forgetDeletions, recordDeckDeletion } from "../tombstones";
import { mergeLibraryState } from "../merge";

const snapshot = () =>
  createLibrarySnapshot({
    librarySections: [
      {
        id: "topic",
        title: "Topic",
        description: "",
        decks: [
          {
            id: "deck",
            title: "Deck",
            subtitle: "",
            cards: [
              { id: "c1", term: "one", definition: "first" },
              { id: "c2", term: "two", definition: "second" },
            ],
          },
        ],
      },
    ],
    deckProgress: {
      deck: { currentCardId: "c1", knownIds: ["c1"], isFlipped: false, studyMode: "all" },
    },
    selectedDeckId: "deck",
    preferences: {
      pinnedDeckIds: ["deck"],
      recentDecks: [{ id: "deck", viewedAt: 5 }],
      deckLastViewed: { deck: 5 },
      theme: "dark",
      accentColor: "green",
      updatedAt: 5,
    },
  });

describe("buildBackupFileName", () => {
  it("names the file after the day it was taken", () => {
    expect(buildBackupFileName(new Date(2026, 7, 31))).toBe("flashcards-backup-2026-08-31.json");
  });

  it("pads single-digit months and days", () => {
    expect(buildBackupFileName(new Date(2026, 0, 5))).toBe("flashcards-backup-2026-01-05.json");
  });
});

describe("readBackup", () => {
  it("round-trips a library through a backup file without losing anything", () => {
    const original = snapshot();
    const result = readBackup(serializeBackup(original));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.librarySections).toEqual(original.librarySections);
    expect(result.snapshot.deckProgress).toEqual(original.deckProgress);
    expect(result.snapshot.preferences).toEqual(original.preferences);
    expect(result.snapshot.selectedDeckId).toBe(original.selectedDeckId);
  });

  it("reads a version 1 backup taken before the snapshot upgrade", () => {
    const { tombstones: _t, preferences: _p, ...rest } = snapshot();
    const legacy = JSON.stringify({ ...rest, version: 1, recentDeckIds: ["deck"] });

    const result = readBackup(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.version).toBe(2);
    expect(countBackupCards(result.snapshot)).toBe(2);
  });

  it("reports a file that isn't JSON", () => {
    const result = readBackup("not json at all");
    expect(result).toEqual({
      ok: false,
      message: "That file isn't valid JSON, so it can't be a backup.",
    });
  });

  it("reports valid JSON that isn't a backup", () => {
    expect(readBackup('{"hello":"world"}')).toEqual({
      ok: false,
      message: "That file isn't a flashcards backup.",
    });
  });
});

describe("countBackupCards", () => {
  it("counts every card across topics and decks", () => {
    expect(countBackupCards(snapshot())).toBe(2);
  });

  it("counts an empty library as zero", () => {
    const empty = createLibrarySnapshot({
      librarySections: [],
      deckProgress: {},
      selectedDeckId: "",
    });
    expect(countBackupCards(empty)).toBe(0);
  });
});

describe("restoring a backup", () => {
  it("brings back a deck that was deleted on this device", () => {
    const backup = parseLibrarySnapshot(JSON.parse(serializeBackup(snapshot())))!;
    const local = {
      librarySections: [],
      deckProgress: {},
      tombstones: recordDeckDeletion({ sections: {}, decks: {}, cards: {} }, "deck", 10),
      preferences: backup.preferences,
    };

    const restoredIds = collectEntityIds(backup.librarySections);
    const merged = mergeLibraryState(
      { ...local, tombstones: forgetDeletions(local.tombstones, restoredIds) },
      {
        librarySections: backup.librarySections,
        deckProgress: backup.deckProgress,
        tombstones: forgetDeletions(backup.tombstones, restoredIds),
        preferences: backup.preferences,
      },
    );

    expect(merged.librarySections[0].decks[0].cards.map((card) => card.id)).toEqual(["c1", "c2"]);
    expect(merged.tombstones.decks).toEqual({});
  });

  it("leaves cards added since the backup in place", () => {
    const backup = snapshot();
    const local = {
      librarySections: [
        {
          id: "topic",
          title: "Topic",
          description: "",
          decks: [
            {
              id: "deck",
              title: "Deck",
              subtitle: "",
              cards: [{ id: "c3", term: "three", definition: "third" }],
            },
          ],
        },
      ],
      deckProgress: {},
      tombstones: { sections: {}, decks: {}, cards: {} },
      preferences: backup.preferences,
    };

    const merged = mergeLibraryState(local, {
      librarySections: backup.librarySections,
      deckProgress: backup.deckProgress,
      tombstones: backup.tombstones,
      preferences: backup.preferences,
    });

    expect(merged.librarySections[0].decks[0].cards.map((card) => card.id)).toEqual([
      "c3",
      "c1",
      "c2",
    ]);
  });
});
