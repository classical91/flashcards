import { startTransition, useEffect, useRef, useState } from "react";
import { defaultDeckId } from "../data/decks";
import {
  LibrarySnapshot,
  createLibrarySnapshot,
  parseLibrarySnapshot,
} from "../data/librarySnapshot";
import { SYNC_KEY_STORAGE_KEY } from "../lib/constants";
import { flattenDecks } from "../lib/deckUtils";
import { LibraryState, mergeLibraryState } from "../lib/merge";
import { loadSyncKey, safeRemoveItem, safeSetItem } from "../lib/storage";
import {
  createSyncKey,
  fetchCloudSnapshot,
  isSyncKeyValid,
  normalizeSyncKey,
  saveSnapshotToCloud,
} from "../lib/sync";
import { SyncState } from "../lib/types";

type UseCloudSyncOptions = {
  libraryState: LibraryState;
  selectedDeckId: string;
  /**
   * Writes a completed merge back into the app. Called with the merged state
   * rather than a set of setters so every merge lands in one render, and so
   * the hook never has to know how the app splits that state up.
   */
  applyMergedState: (state: LibraryState, selectedDeckId: string) => void;
};

export type CloudSync = {
  syncKeyInput: string;
  syncState: SyncState;
  syncMessage: string;
  onSyncKeyInputChange: (value: string) => void;
  onApplySyncKey: () => void;
  onGenerateSyncKey: () => void;
  onLoadFromCloud: () => void;
  onSaveToCloud: () => void;
};

const toSnapshot = (state: LibraryState, selectedDeckId: string): LibrarySnapshot =>
  createLibrarySnapshot({
    librarySections: state.librarySections,
    deckProgress: state.deckProgress,
    selectedDeckId,
    tombstones: state.tombstones,
    preferences: state.preferences,
  });

const toLibraryState = (snapshot: LibrarySnapshot): LibraryState => ({
  librarySections: snapshot.librarySections,
  deckProgress: snapshot.deckProgress,
  tombstones: snapshot.tombstones,
  preferences: snapshot.preferences,
});

/**
 * Owns all cloud-sync concerns: the sync key, connection lifecycle, conflict
 * resolution, and the debounced auto-save. It reads the live library state
 * through props and writes merges back through `applyMergedState`.
 */
export function useCloudSync({
  libraryState,
  selectedDeckId,
  applyMergedState,
}: UseCloudSyncOptions): CloudSync {
  const [syncKey, setSyncKey] = useState(loadSyncKey);
  const [syncKeyInput, setSyncKeyInput] = useState(loadSyncKey);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState(
    "Cloud sync uses this private key. Anyone with the key can access or edit this cloud library.",
  );

  const cloudSyncReadyRef = useRef(false);
  const cloudSyncLoadKeyRef = useRef("");
  const cloudRevisionRef = useRef<number | null>(null);

  // Effects below run against whatever the app state was when they were
  // scheduled, so read it through refs instead of closing over stale props.
  const libraryStateRef = useRef(libraryState);
  libraryStateRef.current = libraryState;
  const selectedDeckIdRef = useRef(selectedDeckId);
  selectedDeckIdRef.current = selectedDeckId;
  const applyMergedStateRef = useRef(applyMergedState);
  applyMergedStateRef.current = applyMergedState;

  const mergeRemoteSnapshot = (remoteSnapshot: LibrarySnapshot, preferRemoteSelection: boolean) => {
    const merged = mergeLibraryState(libraryStateRef.current, toLibraryState(remoteSnapshot));
    const mergedDeckIds = new Set(flattenDecks(merged.librarySections).map((deck) => deck.id));
    const localSelection = selectedDeckIdRef.current;
    const remoteSelection = remoteSnapshot.selectedDeckId;
    const nextSelectedDeckId = preferRemoteSelection
      ? mergedDeckIds.has(remoteSelection)
        ? remoteSelection
        : localSelection
      : mergedDeckIds.has(localSelection)
        ? localSelection
        : remoteSelection;
    startTransition(() => {
      applyMergedStateRef.current(
        merged,
        mergedDeckIds.has(nextSelectedDeckId) ? nextSelectedDeckId : defaultDeckId,
      );
    });
  };

  const saveWithConflictResolution = async (activeSyncKey: string) => {
    const snapshot = toSnapshot(libraryStateRef.current, selectedDeckIdRef.current);
    const outcome = await saveSnapshotToCloud(activeSyncKey, snapshot, cloudRevisionRef.current);
    if (!outcome.conflict) {
      if (outcome.revision !== null) cloudRevisionRef.current = outcome.revision;
      return { resolved: true };
    }
    const remoteSnapshot = parseLibrarySnapshot(outcome.current?.snapshot);
    if (!remoteSnapshot) {
      throw new Error("Cloud library changed in an unexpected format.");
    }
    cloudRevisionRef.current =
      typeof outcome.current?.revision === "number" ? outcome.current.revision : null;
    mergeRemoteSnapshot(remoteSnapshot, false);
    return { resolved: false };
  };

  const onSyncKeyInputChange = (value: string) => {
    cloudSyncReadyRef.current = false;
    setSyncKeyInput(value);
  };

  const onApplySyncKey = () => {
    const nextSyncKey = normalizeSyncKey(syncKeyInput);
    if (!isSyncKeyValid(nextSyncKey)) {
      cloudSyncReadyRef.current = false;
      setSyncState("error");
      setSyncMessage(
        "Sync keys must be 8-120 characters and use only letters, numbers, hyphens, or underscores.",
      );
      return;
    }
    cloudSyncReadyRef.current = false;
    setSyncKey(nextSyncKey);
    setSyncKeyInput(nextSyncKey);
    setSyncState("saved");
    setSyncMessage("Sync key is active. Save to cloud here, then load cloud on your phone or PC.");
  };

  const onGenerateSyncKey = () => {
    const nextSyncKey = createSyncKey();
    cloudSyncReadyRef.current = false;
    setSyncKey(nextSyncKey);
    setSyncKeyInput(nextSyncKey);
    setSyncState("saved");
    setSyncMessage("New sync key created. Save to cloud to publish this library to your devices.");
  };

  const onLoadFromCloud = async () => {
    const activeSyncKey = normalizeSyncKey(syncKeyInput || syncKey);
    if (!isSyncKeyValid(activeSyncKey)) {
      setSyncState("error");
      setSyncMessage("Enter a valid sync key before loading from cloud.");
      return;
    }
    cloudSyncReadyRef.current = false;
    setSyncState("loading");
    setSyncMessage("Loading cloud library...");
    try {
      const payload = await fetchCloudSnapshot(activeSyncKey);
      if (!payload.exists) {
        setSyncKey(activeSyncKey);
        setSyncKeyInput(activeSyncKey);
        cloudRevisionRef.current = 0;
        setSyncState("error");
        setSyncMessage("No cloud library exists for this key yet. Save it first.");
        return;
      }
      const snapshot = parseLibrarySnapshot(payload.snapshot);
      if (!snapshot) throw new Error("The cloud library was not in the expected format.");
      cloudRevisionRef.current = typeof payload.revision === "number" ? payload.revision : null;
      mergeRemoteSnapshot(snapshot, true);
      setSyncKey(activeSyncKey);
      setSyncKeyInput(activeSyncKey);
      cloudSyncReadyRef.current = true;
      setSyncState("saved");
      setSyncMessage("Merged the cloud library with this device. New changes will auto-save.");
    } catch (error) {
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "Could not load from cloud.");
    }
  };

  const onSaveToCloud = async () => {
    const activeSyncKey = normalizeSyncKey(syncKeyInput || syncKey);
    if (!isSyncKeyValid(activeSyncKey)) {
      setSyncState("error");
      setSyncMessage("Enter a valid sync key before saving to cloud.");
      return;
    }
    setSyncState("saving");
    setSyncMessage("Saving this device's library to cloud...");
    try {
      const result = await saveWithConflictResolution(activeSyncKey);
      setSyncKey(activeSyncKey);
      setSyncKeyInput(activeSyncKey);
      cloudSyncReadyRef.current = true;
      if (result.resolved) {
        setSyncState("saved");
        setSyncMessage("Saved to cloud. Use this key on your phone or PC and load cloud.");
      } else {
        setSyncState("saving");
        setSyncMessage("Merged newer cloud changes with this device. Re-saving...");
      }
    } catch (error) {
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "Could not save to cloud.");
    }
  };

  useEffect(() => {
    if (syncKey) {
      safeSetItem(SYNC_KEY_STORAGE_KEY, syncKey);
    } else {
      safeRemoveItem(SYNC_KEY_STORAGE_KEY);
    }
  }, [syncKey]);

  useEffect(() => {
    if (!syncKey || cloudSyncLoadKeyRef.current === syncKey) return;
    cloudSyncLoadKeyRef.current = syncKey;
    cloudSyncReadyRef.current = false;
    cloudRevisionRef.current = null;
    setSyncState("loading");
    setSyncMessage("Connecting this device to cloud...");
    fetchCloudSnapshot(syncKey)
      .then((payload) => {
        if (!payload.exists) {
          cloudRevisionRef.current = 0;
          cloudSyncReadyRef.current = false;
          setSyncState("idle");
          setSyncMessage("This private key has no cloud library yet. Save to cloud when ready.");
          return;
        }
        const snapshot = parseLibrarySnapshot(payload.snapshot);
        if (!snapshot) throw new Error("The cloud library was not in the expected format.");
        cloudRevisionRef.current = typeof payload.revision === "number" ? payload.revision : null;
        mergeRemoteSnapshot(snapshot, false);
        cloudSyncReadyRef.current = true;
        setSyncState("saved");
        setSyncMessage("Cloud sync is active on this device. Changes will auto-save.");
      })
      .catch((error) => {
        cloudSyncLoadKeyRef.current = "";
        setSyncState("error");
        setSyncMessage(error instanceof Error ? error.message : "Could not connect to cloud sync.");
      });
  }, [syncKey]);

  useEffect(() => {
    if (!syncKey || !cloudSyncReadyRef.current) return;
    setSyncState("saving");
    setSyncMessage("Auto-saving changes to cloud...");
    const timer = window.setTimeout(() => {
      saveWithConflictResolution(syncKey)
        .then((result) => {
          if (result.resolved) {
            setSyncState("saved");
            setSyncMessage("Cloud sync is up to date.");
          } else {
            setSyncMessage("Merged newer cloud changes with this device. Re-saving...");
          }
        })
        .catch((error) => {
          setSyncState("error");
          setSyncMessage(error instanceof Error ? error.message : "Cloud auto-save failed.");
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [libraryState, selectedDeckId, syncKey]);

  return {
    syncKeyInput,
    syncState,
    syncMessage,
    onSyncKeyInputChange,
    onApplySyncKey,
    onGenerateSyncKey,
    onLoadFromCloud,
    onSaveToCloud,
  };
}
