import { LibrarySnapshot } from "../data/librarySnapshot";
import { syncKeyPattern } from "./constants";

export const normalizeSyncKey = (value: string) => value.trim();
export const isSyncKeyValid = (value: string) => syncKeyPattern.test(value);
export const getBuildSyncKey = (value: string | undefined) => {
  const normalized = normalizeSyncKey(value ?? "");
  return isSyncKeyValid(normalized) ? normalized : null;
};

export const createSyncKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `fc_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  }
  return `fc_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
};

export const getFetchErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.clone().json()) as { message?: string; error?: string };
    return payload.message ?? payload.error ?? `Request failed with ${response.status}.`;
  } catch {
    try {
      const message = (await response.text()).trim();
      if (message) return `${message} (${response.status})`;
    } catch {
      // fall through
    }
    return `Request failed with ${response.status}.`;
  }
};

export const fetchCloudSnapshot = async (activeSyncKey: string) => {
  const response = await fetch(`/api/libraries/${encodeURIComponent(activeSyncKey)}`);
  if (!response.ok) throw new Error(await getFetchErrorMessage(response));
  return (await response.json()) as {
    exists?: boolean;
    snapshot?: unknown;
    revision?: number;
    storage?: string;
  };
};

export type SaveOutcome =
  | { conflict: false; revision: number | null }
  | { conflict: true; current: { snapshot?: unknown; revision?: number } | null };

export const saveSnapshotToCloud = async (
  activeSyncKey: string,
  snapshot: LibrarySnapshot,
  expectedRevision: number | null,
): Promise<SaveOutcome> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (expectedRevision !== null) {
    headers["If-Match"] = String(expectedRevision);
  }
  const response = await fetch(`/api/libraries/${encodeURIComponent(activeSyncKey)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(snapshot),
  });
  if (response.status === 409) {
    const payload = (await response.json().catch(() => ({}))) as {
      current?: { snapshot?: unknown; revision?: number } | null;
    };
    return { conflict: true, current: payload.current ?? null };
  }
  if (!response.ok) throw new Error(await getFetchErrorMessage(response));
  const payload = (await response.json().catch(() => ({}))) as { revision?: number };
  return {
    conflict: false,
    revision: typeof payload.revision === "number" ? payload.revision : null,
  };
};
