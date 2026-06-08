import { Dispatch, SetStateAction, startTransition, useEffect, useRef, useState } from "react";
import { defaultDeckId } from "../data/decks";
import { DeckSection } from "../data/deckBuilder";
import {
  DeckProgress,
  LibrarySnapshot,
  createLibrarySnapshot,
  parseLibrarySnapshot,
} from "../data/librarySnapshot";
import { DEFAULT_SYNC_KEY, SYNC_KEY_STORAGE_KEY } from "../lib/constants";
import { flattenDecks, mergeProgressState, mergeSections } from "../lib/deckUtils";
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
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  selectedDeckId: string;
  setLibrarySections: Dispatch<SetStateAction<DeckSection[]>>;
  setDeckProgress: Dispatch<SetStateAction<Record<string, DeckProgress>>>;
  setSelectedDeckId: Dispatch<SetStateAction<string>>;
};

export type CloudSync = {
  syncKeyInput: string;
  syncState: SyncState;
  syncMessage: string;
  isUsingSharedSyncKey: boolean;
  onSyncKeyInputChange: (value: string) => void;
  onApplySyncKey: () => void;
  onGenerateSyncKey: () => void;
  onUseSharedLibrary: () => void;
  onLoadFromCloud: () => void;
  onSaveToCloud: () => void;
};

/**
 * Owns all cloud-sync concerns: the sync key, connection lifecycle, conflict
 * resolution, and the debounced auto-save. It reads the live library/progress
 * state through props and writes merges back through the provided setters.
 */
export function useCloudSync({
  librarySections,
  deckProgress,
  selectedDeckId,
  setLibrarySections,
  setDeckProgress,
  setSelectedDeckId,
}: UseCloudSyncOptions): CloudSync {
  const [syncKey, setSyncKey] = useState(loadSyncKey);
  const [syncKeyInput, setSyncKeyInput] = useState(loadSyncKey);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState(
    "Cloud sync starts automatically for this shared library.",
  );

  const cloudSyncReadyRef = useRef(false);
  const cloudSyncLoadKeyRef = useRef("");
  const cloudRevisionRef = useRef<number | null>(null);
  const snapshotRef = useRef<LibrarySnapshot>(
    createLibrarySnapshot({
      librarySections,
      deckProgress,
      selectedDeckId,
      recentDeckIds: [],
    }),
  );

  const isUsingSharedSyncKey = normalizeSyncKey(syncKeyInput) === DEFAULT_SYNC_KEY;

  const applyRemoteSnapshotMerge = (remoteSnapshot: LibrarySnapshot) => {
    const mergedSections = mergeSections(librarySections, remoteSnapshot.librarySections);
    const mergedProgress = mergeProgressState(deckProgress, remoteSnapshot.deckProgress, mergedSections);
    const mergedDeckIds = new Set(flattenDecks(mergedSections).map((deck) => deck.id));
    const nextSelectedDeckId = mergedDeckIds.has(selectedDeckId)
      ? selectedDeckId
      : remoteSnapshot.selectedDeckId;
    startTransition(() => {
      setLibrarySections(mergedSections);
      setDeckProgress(mergedProgress);
      setSelectedDeckId(nextSelectedDeckId || defaultDeckId);
    });
  };

  const saveWithConflictResolution = async (
    activeSyncKey: string,
    snapshot: LibrarySnapshot,
  ) => {
    const outcome = await saveSnapshotToCloud(
      activeSyncKey,
      snapshot,
      cloudRevisionRef.current,
    );
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
    applyRemoteSnapshotMerge(remoteSnapshot);
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

  const onUseSharedLibrary = () => {
    cloudSyncReadyRef.current = false;
    cloudSyncLoadKeyRef.current = "";
    setSyncKey(DEFAULT_SYNC_KEY);
    setSyncKeyInput(DEFAULT_SYNC_KEY);
    setSyncState("loading");
    setSyncMessage("Switching this browser back to the shared cloud library...");
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
      const mergedSections = mergeSections(librarySections, snapshot.librarySections);
      const mergedProgress = mergeProgressState(deckProgress, snapshot.deckProgress, mergedSections);
      const mergedDeckIds = new Set(flattenDecks(mergedSections).map((deck) => deck.id));
      const nextSelectedDeckId = mergedDeckIds.has(snapshot.selectedDeckId)
        ? snapshot.selectedDeckId
        : selectedDeckId;
      startTransition(() => {
        setLibrarySections(mergedSections);
        setDeckProgress(mergedProgress);
        setSelectedDeckId(nextSelectedDeckId || defaultDeckId);
      });
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
      const result = await saveWithConflictResolution(activeSyncKey, snapshotRef.current);
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
    snapshotRef.current = createLibrarySnapshot({
      librarySections,
      deckProgress,
      selectedDeckId,
      recentDeckIds: [],
    });
  }, [librarySections, deckProgress, selectedDeckId]);

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
          return saveSnapshotToCloud(syncKey, snapshotRef.current, 0).then((outcome) => {
            if (outcome.conflict) {
              throw new Error("Another device created this cloud library at the same moment.");
            }
            if (outcome.revision !== null) cloudRevisionRef.current = outcome.revision;
            cloudSyncReadyRef.current = true;
            setSyncState("saved");
            setSyncMessage("Created a cloud library for this key. Changes will auto-save.");
          });
        }
        const snapshot = parseLibrarySnapshot(payload.snapshot);
        if (!snapshot) throw new Error("The cloud library was not in the expected format.");
        cloudRevisionRef.current =
          typeof payload.revision === "number" ? payload.revision : null;
        const mergedSections = mergeSections(librarySections, snapshot.librarySections);
        const mergedProgress = mergeProgressState(
          deckProgress,
          snapshot.deckProgress,
          mergedSections,
        );
        const mergedDeckIds = new Set(flattenDecks(mergedSections).map((deck) => deck.id));
        const nextSelectedDeckId = mergedDeckIds.has(selectedDeckId)
          ? selectedDeckId
          : snapshot.selectedDeckId;
        startTransition(() => {
          setLibrarySections(mergedSections);
          setDeckProgress(mergedProgress);
          setSelectedDeckId(nextSelectedDeckId || defaultDeckId);
        });
        cloudSyncReadyRef.current = true;
        setSyncState("saved");
        setSyncMessage("Cloud sync is active on this device. Changes will auto-save.");
      })
      .catch((error) => {
        cloudSyncLoadKeyRef.current = "";
        setSyncState("error");
        setSyncMessage(
          error instanceof Error ? error.message : "Could not connect to cloud sync.",
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  useEffect(() => {
    if (!syncKey || !cloudSyncReadyRef.current) return;
    setSyncState("saving");
    setSyncMessage("Auto-saving changes to cloud...");
    const timer = window.setTimeout(() => {
      saveWithConflictResolution(syncKey, snapshotRef.current)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [librarySections, deckProgress, selectedDeckId, syncKey]);

  return {
    syncKeyInput,
    syncState,
    syncMessage,
    isUsingSharedSyncKey,
    onSyncKeyInputChange,
    onApplySyncKey,
    onGenerateSyncKey,
    onUseSharedLibrary,
    onLoadFromCloud,
    onSaveToCloud,
  };
}
