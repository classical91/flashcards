import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Deck, DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import { ACCENT_COLORS } from "../lib/constants";
import { findDeckById, findSectionForDeck } from "../lib/deckUtils";
import { formatRelativeTime } from "../lib/format";
import {
  AccentColor,
  RecentDeckEntry,
  SectionComposer,
  SyncState,
  Theme,
  ViewState,
} from "../lib/types";

type HomeViewProps = {
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  allDecks: Deck[];
  recentDeckIds: RecentDeckEntry[];
  pinnedDeckIds: string[];
  showActionsMenu: boolean;
  setShowActionsMenu: Dispatch<SetStateAction<boolean>>;
  actionsMenuRef: MutableRefObject<HTMLDivElement | null>;
  setView: (view: ViewState) => void;
  openDeck: (deckId: string) => void;
  openRandomDeck: (decks: Deck[]) => void;
  // Sync panel
  syncState: SyncState;
  syncMessage: string;
  syncKeyInput: string;
  onSyncKeyInputChange: (value: string) => void;
  isUsingSharedSyncKey: boolean;
  showSyncPanel: boolean;
  setShowSyncPanel: Dispatch<SetStateAction<boolean>>;
  onApplySyncKey: () => void;
  onLoadFromCloud: () => void;
  onSaveToCloud: () => void;
  onUseSharedLibrary: () => void;
  onGenerateSyncKey: () => void;
  // Themes panel
  showThemesPanel: boolean;
  setShowThemesPanel: Dispatch<SetStateAction<boolean>>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
  // Section composer
  sectionComposer: SectionComposer | null;
  setSectionComposer: Dispatch<SetStateAction<SectionComposer | null>>;
  sectionComposerMessage: string;
  setSectionComposerMessage: (message: string) => void;
  onCreateSection: () => void;
};

const ACCENT_EMOJI: Record<AccentColor, string> = {
  blue: "🔵",
  purple: "🟣",
  green: "🟢",
  red: "🔴",
  amber: "🟡",
};

export function HomeView({
  librarySections,
  deckProgress,
  allDecks,
  recentDeckIds,
  pinnedDeckIds,
  showActionsMenu,
  setShowActionsMenu,
  actionsMenuRef,
  setView,
  openDeck,
  openRandomDeck,
  syncState,
  syncMessage,
  syncKeyInput,
  onSyncKeyInputChange,
  isUsingSharedSyncKey,
  showSyncPanel,
  setShowSyncPanel,
  onApplySyncKey,
  onLoadFromCloud,
  onSaveToCloud,
  onUseSharedLibrary,
  onGenerateSyncKey,
  showThemesPanel,
  setShowThemesPanel,
  theme,
  setTheme,
  accentColor,
  setAccentColor,
  sectionComposer,
  setSectionComposer,
  sectionComposerMessage,
  setSectionComposerMessage,
  onCreateSection,
}: HomeViewProps) {
  const recentDecks = recentDeckIds
    .map((entry) => {
      const deck = findDeckById(librarySections, entry.id);
      const section = deck ? findSectionForDeck(librarySections, deck.id) : null;
      return deck && section ? { deck, section, viewedAt: entry.viewedAt } : null;
    })
    .filter((x): x is { deck: Deck; section: DeckSection; viewedAt: number } => x !== null);

  return (
    <div className="home-view">
      <div className="home-header">
        <h1 className="home-title">Flashcards</h1>
        <div className="home-header-actions" ref={actionsMenuRef}>
          <button
            className="home-actions-trigger"
            onClick={() => setShowActionsMenu((v) => !v)}
            title="Actions"
          >
            ⋯
          </button>
          {showActionsMenu && (
            <div className="home-actions-menu">
              <button
                className="home-actions-item"
                onClick={() => { setShowActionsMenu(false); setShowSyncPanel((v) => !v); }}
              >
                {syncState === "loading" || syncState === "saving" ? "Syncing…" : "☁ Sync"}
              </button>
              {pinnedDeckIds.length > 0 && (
                <button
                  className="home-actions-item"
                  onClick={() => { setShowActionsMenu(false); setView({ kind: "pinned" }); }}
                >
                  📌 Pinned ({pinnedDeckIds.length})
                </button>
              )}
              <button
                className="home-actions-item"
                onClick={() => { setShowActionsMenu(false); openRandomDeck(allDecks); }}
                disabled={allDecks.length === 0}
              >
                Shuffle home
              </button>
              <button
                className="home-actions-item"
                onClick={() => {
                  setShowActionsMenu(false);
                  setSectionComposerMessage("");
                  setSectionComposer({ title: "", description: "" });
                }}
              >
                + New topic
              </button>
              <button
                className="home-actions-item"
                onClick={() => { setShowActionsMenu(false); setShowThemesPanel((v) => !v); }}
                style={{ color: "var(--accent)", fontWeight: 500 }}
              >
                🎨 Themes
              </button>
            </div>
          )}
        </div>
      </div>

      {showSyncPanel && (
        <div className="panel-card home-panel">
          <div className="panel-card-head">
            <strong>Cloud sync</strong>
            <button className="link-btn" onClick={() => setShowSyncPanel(false)}>Close</button>
          </div>
          <div className="field">
            <label>Sync key</label>
            <input
              type="text"
              value={syncKeyInput}
              onChange={(e) => onSyncKeyInputChange(e.target.value)}
              placeholder="Shared cloud library key"
            />
          </div>
          {!isUsingSharedSyncKey && (
            <p className="hint-text">Using a custom sync key.</p>
          )}
          <div className="panel-card-actions">
            <button className="mini-btn" onClick={onApplySyncKey}>Use key</button>
            <button
              className="mini-btn"
              onClick={onLoadFromCloud}
              disabled={syncState === "loading" || syncState === "saving"}
            >
              Load cloud
            </button>
            <button
              className="mini-btn"
              onClick={onSaveToCloud}
              disabled={syncState === "loading" || syncState === "saving"}
            >
              Save to cloud
            </button>
            <button
              className="mini-btn"
              onClick={onUseSharedLibrary}
              disabled={isUsingSharedSyncKey || syncState === "loading" || syncState === "saving"}
            >
              Shared library
            </button>
            <button className="mini-btn" onClick={onGenerateSyncKey}>New key</button>
          </div>
          <p
            className={`message-line${syncState === "error" ? " error" : syncState === "saved" ? " success" : ""}`}
          >
            {syncMessage}
          </p>
        </div>
      )}

      {showThemesPanel && (
        <div className="panel-card home-panel">
          <div className="panel-card-head">
            <strong>Appearance</strong>
            <button className="link-btn" onClick={() => setShowThemesPanel(false)}>Close</button>
          </div>
          <div style={{ display: "grid", gap: "12px" }}>
            <div>
              <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Theme</p>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="mini-btn"
                  onClick={() => setTheme("light")}
                  style={{
                    background: theme === "light" ? "var(--accent)" : "var(--surface)",
                    color: theme === "light" ? "#fff" : "var(--ink)",
                    borderColor: theme === "light" ? "var(--accent)" : "var(--line)",
                  }}
                >
                  ☀ Light
                </button>
                <button
                  className="mini-btn"
                  onClick={() => setTheme("dark")}
                  style={{
                    background: theme === "dark" ? "var(--accent)" : "var(--surface)",
                    color: theme === "dark" ? "#fff" : "var(--ink)",
                    borderColor: theme === "dark" ? "var(--accent)" : "var(--line)",
                  }}
                >
                  🌙 Dark
                </button>
              </div>
            </div>
            <div>
              <p style={{ margin: "0 0 8px 0", fontSize: "12px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Accent color</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(60px, 1fr))", gap: "6px" }}>
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color}
                    className="mini-btn"
                    onClick={() => setAccentColor(color)}
                    style={{
                      background: accentColor === color ? `var(--accent)` : "var(--surface)",
                      color: accentColor === color ? "#fff" : "var(--ink)",
                      borderColor: accentColor === color ? "var(--accent)" : "var(--line)",
                      fontSize: "11px",
                      textTransform: "capitalize",
                    }}
                  >
                    {ACCENT_EMOJI[color]}
                    {" "}{color}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {sectionComposer && (
        <div className="panel-card home-panel">
          <div className="panel-card-head">
            <strong>New topic</strong>
            <button
              className="link-btn"
              onClick={() => { setSectionComposer(null); setSectionComposerMessage(""); }}
            >
              Close
            </button>
          </div>
          <div className="field">
            <label>Topic name</label>
            <input
              type="text"
              value={sectionComposer.title}
              onChange={(e) =>
                setSectionComposer((c) => (c ? { ...c, title: e.target.value } : c))
              }
              placeholder="e.g. Greek Mythology"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <input
              type="text"
              value={sectionComposer.description}
              onChange={(e) =>
                setSectionComposer((c) => (c ? { ...c, description: e.target.value } : c))
              }
              placeholder="Short note about this topic"
            />
          </div>
          {sectionComposerMessage && (
            <p className="message-line error">{sectionComposerMessage}</p>
          )}
          <div className="panel-card-actions">
            <button className="mini-btn" onClick={onCreateSection}>Create topic</button>
          </div>
        </div>
      )}

      <div className="home-main">
        {librarySections.length === 0 ? (
          <div className="empty-state">
            No topics yet. Create one above to get started.
          </div>
        ) : (
          <div className="sections-grid">
            {librarySections.map((section) => {
              const cardCount = section.decks.reduce((sum, d) => sum + d.cards.length, 0);
              const sectionKnown = section.decks.reduce((sum, d) => {
                return sum + (deckProgress[d.id]?.knownIds.length ?? 0);
              }, 0);
              return (
                <button
                  key={section.id}
                  className="section-card"
                  onClick={() => setView({ kind: "section", sectionId: section.id })}
                >
                  <div className="section-card-inner">
                    <div>
                      <div className="section-card-title">{section.title}</div>
                      <div className="section-card-meta">
                        {section.decks.length} deck{section.decks.length !== 1 ? "s" : ""}{" "}
                        · {cardCount} card{cardCount !== 1 ? "s" : ""}
                        {sectionKnown > 0 ? ` · ${sectionKnown} known` : ""}
                      </div>
                      {section.description && (
                        <div className="section-card-desc">{section.description}</div>
                      )}
                    </div>
                    <span className="section-card-arrow">›</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {recentDecks.length > 0 && (
        <div className="home-recent">
          <div className="home-recent-label">Recently viewed</div>
          <div className="home-recent-list">
            {recentDecks.map(({ deck, section, viewedAt }) => (
              <button
                key={deck.id}
                className="home-recent-item"
                onClick={() => openDeck(deck.id)}
              >
                <div className="home-recent-item-info">
                  <span className="home-recent-item-title">{deck.title}</span>
                  <span className="home-recent-item-section">{section.title}</span>
                </div>
                <span className="home-recent-item-time">{formatRelativeTime(viewedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
