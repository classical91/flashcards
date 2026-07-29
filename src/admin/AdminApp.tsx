import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import "./admin.css";

type LibraryDeck = {
  sectionTitle: string;
  deckId: string;
  deckTitle: string;
  cardCount: number;
};

type LibrarySummary = {
  libraryId: string;
  updatedAt: string;
  revision: number;
  sectionCount: number;
  deckCount: number;
  cardCount: number;
  decks: LibraryDeck[];
};

type LibraryDirectory = {
  count: number;
  storage: string;
  libraries: LibrarySummary[];
};

type SessionState = "checking" | "signed-out" | "signed-in";

const requestJson = async <T,>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok) {
    throw new Error(payload.message || "The request could not be completed.");
  }

  return payload;
};

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export default function AdminApp() {
  const [session, setSession] = useState<SessionState>("checking");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [directory, setDirectory] = useState<LibraryDirectory | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LibrarySummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  const loadLibraries = useCallback(async () => {
    const payload = await requestJson<LibraryDirectory>("/api/admin/libraries?limit=500");
    setDirectory(payload);
  }, []);

  useEffect(() => {
    document.title = "Flashcards Administration";

    requestJson<{ authenticated: boolean }>("/api/admin/session")
      .then(async ({ authenticated }) => {
        if (!authenticated) {
          setSession("signed-out");
          return;
        }

        setSession("signed-in");
        await loadLibraries();
      })
      .catch(() => setSession("signed-out"));
  }, [loadLibraries]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await requestJson("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      setSession("signed-in");
      await loadLibraries();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await requestJson("/api/admin/session", { method: "DELETE" });
    } finally {
      setDirectory(null);
      setSession("signed-out");
      setBusy(false);
    }
  };

  const copyKey = async (libraryId: string) => {
    await navigator.clipboard.writeText(libraryId);
    setCopiedKey(libraryId);
    window.setTimeout(() => setCopiedKey(""), 1600);
  };

  const deleteLibrary = async () => {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.libraryId) return;

    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/admin/libraries/${encodeURIComponent(deleteTarget.libraryId)}`, {
        method: "DELETE",
        headers: { "X-Confirm-Library-Id": deleteTarget.libraryId },
      });
      setDirectory((current) =>
        current
          ? {
              ...current,
              count: current.count - 1,
              libraries: current.libraries.filter(
                (library) => library.libraryId !== deleteTarget.libraryId,
              ),
            }
          : current,
      );
      setDeleteTarget(null);
      setDeleteConfirmation("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Deletion failed.");
    } finally {
      setBusy(false);
    }
  };

  const visibleLibraries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return directory?.libraries ?? [];

    return (directory?.libraries ?? []).filter(
      (library) =>
        library.libraryId.toLowerCase().includes(normalized) ||
        library.decks.some((deck) => deck.deckTitle.toLowerCase().includes(normalized)),
    );
  }, [directory, query]);

  if (session === "checking") {
    return (
      <main className="admin-gate admin-loading" aria-live="polite">
        <span className="admin-pulse" />
        Checking administration session
      </main>
    );
  }

  if (session === "signed-out") {
    return (
      <main className="admin-gate">
        <section className="admin-login" aria-labelledby="admin-login-title">
          <a className="admin-back-link" href="/">
            Flashcards Library
          </a>
          <p className="admin-kicker">Restricted workspace</p>
          <h1 id="admin-login-title">Administration</h1>
          <p className="admin-login-copy">
            Sign in to inspect cloud libraries and remove obsolete records.
          </p>

          <form onSubmit={signIn}>
            <label>
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error ? <p className="admin-error">{error}</p> : null}
            <button className="admin-primary" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const totalCards = directory?.libraries.reduce((sum, library) => sum + library.cardCount, 0) ?? 0;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-wordmark" href="/">
          FC
        </a>
        <div>
          <p className="admin-sidebar-label">Workspace</p>
          <strong>Libraries</strong>
        </div>
        <button className="admin-signout" disabled={busy} onClick={signOut}>
          Sign out
        </button>
      </aside>

      <main className="admin-workspace">
        <header className="admin-header">
          <div>
            <p className="admin-kicker">Administration</p>
            <h1>Cloud libraries</h1>
            <p>Review every stored sync key. Deletion is permanent.</p>
          </div>
          <button className="admin-refresh" disabled={busy} onClick={loadLibraries}>
            Refresh
          </button>
        </header>

        <section className="admin-summary" aria-label="Library totals">
          <div>
            <span>Stored libraries</span>
            <strong>{directory?.count ?? "—"}</strong>
          </div>
          <div>
            <span>Total cards</span>
            <strong>{totalCards.toLocaleString()}</strong>
          </div>
          <div>
            <span>Storage</span>
            <strong>{directory?.storage ?? "—"}</strong>
          </div>
        </section>

        <section className="admin-directory" aria-labelledby="directory-title">
          <div className="admin-directory-toolbar">
            <div>
              <h2 id="directory-title">Library directory</h2>
              <p>{visibleLibraries.length} records shown</p>
            </div>
            <input
              aria-label="Search libraries"
              placeholder="Search key or deck title"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {error ? <p className="admin-error admin-error-wide">{error}</p> : null}

          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sync key</th>
                  <th>Updated</th>
                  <th>Revision</th>
                  <th>Decks</th>
                  <th>Cards</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleLibraries.map((library) => (
                  <tr key={library.libraryId}>
                    <td>
                      <button
                        className="admin-key"
                        title="Copy full sync key"
                        onClick={() => copyKey(library.libraryId)}
                      >
                        {library.libraryId}
                        <span>{copiedKey === library.libraryId ? "Copied" : "Copy"}</span>
                      </button>
                    </td>
                    <td>{formatUpdatedAt(library.updatedAt)}</td>
                    <td>{library.revision.toLocaleString()}</td>
                    <td>{library.deckCount.toLocaleString()}</td>
                    <td>{library.cardCount.toLocaleString()}</td>
                    <td>
                      <button
                        className="admin-delete"
                        onClick={() => {
                          setDeleteTarget(library);
                          setDeleteConfirmation("");
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {deleteTarget ? (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            aria-describedby="delete-library-copy"
            aria-labelledby="delete-library-title"
            aria-modal="true"
            className="admin-dialog"
            role="dialog"
          >
            <p className="admin-kicker">Permanent action</p>
            <h2 id="delete-library-title">Delete cloud library?</h2>
            <p id="delete-library-copy">
              This removes {deleteTarget.cardCount.toLocaleString()} cards stored under this key.
              Type the full key to confirm.
            </p>
            <code>{deleteTarget.libraryId}</code>
            <input
              aria-label="Type the full sync key to confirm"
              autoFocus
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
            <div className="admin-dialog-actions">
              <button
                className="admin-cancel"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="admin-delete-confirm"
                disabled={busy || deleteConfirmation !== deleteTarget.libraryId}
                onClick={deleteLibrary}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
