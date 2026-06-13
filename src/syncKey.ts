export const SYNC_KEY_STORAGE_KEY = "flashcards.syncKey.v1";

export const syncKeyPattern = /^[A-Za-z0-9_-]{8,120}$/;

export const normalizeSyncKey = (value: string) => value.trim();

export const getBuildSyncKey = (value: string | undefined): string | null => {
  const normalized = normalizeSyncKey(value ?? "");
  return syncKeyPattern.test(normalized) ? normalized : null;
};

export const isSyncKeyValid = (value: string) => syncKeyPattern.test(normalizeSyncKey(value));

export const createSyncKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `fc_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  }

  return `fc_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
};

export const loadSyncKey = (
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  buildSyncKey: string | null,
) => {
  const saved = storage?.getItem(SYNC_KEY_STORAGE_KEY) ?? "";

  if (isSyncKeyValid(saved)) {
    return normalizeSyncKey(saved);
  }

  if (buildSyncKey) {
    return buildSyncKey;
  }

  const generated = createSyncKey();
  storage?.setItem(SYNC_KEY_STORAGE_KEY, generated);
  return generated;
};
