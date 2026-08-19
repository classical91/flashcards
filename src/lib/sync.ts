import { LibrarySnapshot } from "../data/librarySnapshot";
import { syncKeyPattern } from "./constants";

export const normalizeSyncKey = (value: string) => value.trim();
export const isSyncKeyValid = (value: string) => syncKeyPattern.test(value);
export const getBuildSyncKey = (value: string | undefined) => {
  const normalized = normalizeSyncKey(value ?? "");
  return isSyncKeyValid(normalized) ? normalized : null;
};

/**
 * Mints a sync key.
 *
 * The key is the only thing protecting a cloud library — anyone holding it can
 * read or overwrite that library — so every branch here has to be
 * cryptographically random. `randomUUID` is unavailable outside secure contexts
 * and on older Safari, hence the `getRandomValues` step before the last resort.
 *
 * The `fc_` prefix is load-bearing: the server requires it to CREATE a library,
 * which is what stops a hand-typed key like "flashcards" from opening a
 * guessable one.
 */
export const createSyncKey = () => {
  // Typed as possibly-undefined rather than probed with `in`: the DOM lib types
  // both methods as always present, so `in` narrows the later branches to never.
  const webCrypto: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return `fc_${webCrypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(12));
    return `fc_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  // Last resort only. Math.random is not cryptographically random and Date.now
  // is outright predictable, so this sits strictly behind both branches above
  // rather than being a general fallback.
  const random = () => Math.random().toString(36).slice(2).padStart(11, "0");
  return `fc_${`${random()}${random()}`.slice(0, 24)}`;
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
