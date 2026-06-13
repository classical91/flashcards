import { describe, expect, it, vi } from "vitest";
import { SYNC_KEY_STORAGE_KEY } from "../lib/constants";
import { loadSyncKey } from "../lib/storage";
import { isSyncKeyValid } from "../lib/sync";

const createStorage = (initialValue?: string) => {
  let value = initialValue ?? null;

  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
};

describe("loadSyncKey", () => {
  it("preserves an existing valid saved sync key", () => {
    const storage = createStorage("existing-private-key");

    expect(loadSyncKey(storage, null)).toBe("existing-private-key");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("uses an explicit build sync key when no saved key exists", () => {
    const storage = createStorage();

    expect(loadSyncKey(storage, "build-private-key")).toBe("build-private-key");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("generates and stores a private sync key when no valid saved or build key exists", () => {
    const storage = createStorage("bad");
    const syncKey = loadSyncKey(storage, null);

    expect(isSyncKeyValid(syncKey)).toBe(true);
    expect(syncKey.startsWith("fc_")).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(SYNC_KEY_STORAGE_KEY, syncKey);
  });
});
