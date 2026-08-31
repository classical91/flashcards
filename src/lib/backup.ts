import { LibrarySnapshot, parseLibrarySnapshot } from "../data/librarySnapshot";

export const BACKUP_FILE_PREFIX = "flashcards-backup";

/**
 * `flashcards-backup-2026-08-31.json`. Dated rather than timestamped so a
 * second backup on the same day replaces the first in the browser's downloads
 * folder instead of leaving a pile of near-identical files.
 */
export const buildBackupFileName = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${BACKUP_FILE_PREFIX}-${stamp}.json`;
};

/** Pretty-printed: a backup is meant to be readable and diffable by hand. */
export const serializeBackup = (snapshot: LibrarySnapshot) => JSON.stringify(snapshot, null, 2);

export type BackupReadResult =
  | { ok: true; snapshot: LibrarySnapshot }
  | { ok: false; message: string };

/**
 * Reads a backup file's text. Anything the app itself wrote goes through
 * parseLibrarySnapshot, so an older version 1 backup is upgraded rather than
 * refused — the whole point of a backup is that it still works later.
 */
export const readBackup = (text: string): BackupReadResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file isn't valid JSON, so it can't be a backup." };
  }

  const snapshot = parseLibrarySnapshot(parsed);
  if (!snapshot) {
    return { ok: false, message: "That file isn't a flashcards backup." };
  }

  return { ok: true, snapshot };
};

export const countBackupCards = (snapshot: LibrarySnapshot) =>
  snapshot.librarySections.reduce(
    (total, section) =>
      total + section.decks.reduce((sectionTotal, deck) => sectionTotal + deck.cards.length, 0),
    0,
  );

/**
 * Hands the file to the browser. Uses an object URL rather than a data: URL so
 * a large library isn't capped by the URL length limit.
 */
export const downloadTextFile = (fileName: string, text: string, mimeType = "application/json") => {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
