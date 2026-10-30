import { ChangeEvent, Dispatch, MutableRefObject, SetStateAction, useRef, useState } from "react";
import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import { ACCENT_COLORS, SECTION_SORT_STORAGE_KEY } from "../lib/constants";
import {
  SectionSortMode,
  countLearnedCards,
  findDeckById,
  findSectionForDeck,
  sortSections,
} from "../lib/deckUtils";
import { MAX_SEARCH_RESULTS, searchLibrary } from "../lib/search";
import { formatRelativeTime } from "../lib/format";
import { loadSectionSortMode, safeSetItem } from "../lib/storage";
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
  /** `cardId` opens the deck at that card — used by the card search results. */
  openDeck: (deckId: string, cardId?: string) => void;
  openRandomDeck: (decks: Deck[]) => void;
  // Sync panel
  syncState: SyncState;
  syncMessage: string;
  syncKeyInput: string;
  onSyncKeyInputChange: (value: string) => void;
  showSyncPanel: boolean;
  setShowSyncPanel: Dispatch<SetStateAction<boolean>>;
  onApplySyncKey: () => void;
  onLoadFromCloud: () => void;
  onSaveToCloud: () => void;
  onGenerateSyncKey: () => void;
  // Local backup
  backupMessage: string;
  onDownloadBackup: () => void;
  onRestoreBackup: (file: File) => void;
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
  // Card of the day
  dailyCard: { deck: Deck; card: Flashcard; section: DeckSection | null } | null;
  // Today's reviews
  reviewSummary: {
    totalDue: number;
    /** `dueToday` is what the day holds; some of it may not be ready yet. */
    decks: { deck: Deck; section: DeckSection; dueToday: number }[];
  };
  onStartReview: (deckId: string) => void;
};

const SORT_OPTIONS: { mode: SectionSortMode; label: string; title: string }[] = [
  { mode: "default", label: "Default", title: "Library order" },
  { mode: "title", label: "A–Z", title: "Alphabetical by topic name" },
  { mode: "title-desc", label: "Z–A", title: "Reverse alphabetical by topic name" },
];

/** Enough to act on at a glance; the rest are reachable from their topic. */
const MAX_REVIEW_DECKS = 5;

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
  showSyncPanel,
  setShowSyncPanel,
  onApplySyncKey,
  onLoadFromCloud,
  onSaveToCloud,
  onGenerateSyncKey,
  backupMessage,
  onDownloadBackup,
  onRestoreBackup,
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
  dailyCard,
  reviewSummary,
  onStartReview,
}: HomeViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState(loadSectionSortMode);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  // Keyed by card id so tomorrow's card starts face down again.

  const handleRestoreFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared straight away so picking the same file twice still fires.
    event.target.value = "";
    if (file) onRestoreBackup(file);
  };

  const recentDecks = recentDeckIds
    .map((entry) => {
      const deck = findDeckById(librarySections, entry.id);
      const section = deck ? findSectionForDeck(librarySections, deck.id) : null;
      return deck && section ? { deck, section, viewedAt: entry.viewedAt } : null;
    })
    .filter((x): x is { deck: Deck; section: DeckSection; viewedAt: number } => x !== null);

  const orderedSections = sortSections(librarySections, sortMode);

  const changeSortMode = (mode: SectionSortMode) => {
    setSortMode(mode);
    safeSetItem(SECTION_SORT_STORAGE_KEY, mode);
  };

  const trimmedQuery = searchQuery.trim();
  const { results: searchResults, total: searchTotal } = searchLibrary(
    librarySections,
    trimmedQuery,
  );

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
                onClick={() => {
                  setShowActionsMenu(false);
                  setShowSyncPanel((v) => !v);
                }}
              >
                {syncState === "loading" || syncState === "saving" ? "Syncing…" : "☁ Sync"}
              </button>
              {pinnedDeckIds.length > 0 && (
                <button
                  className="home-actions-item"
                  onClick={() => {
                    setShowActionsMenu(false);
                    setView({ kind: "pinned" });
                  }}
                >
                  📌 Pinned ({pinnedDeckIds.length})
                </button>
              )}
              <button
                className="home-actions-item"
                onClick={() => {
                  setShowActionsMenu(false);
                  setShowThemesPanel((v) => !v);
                }}
                style={{ color: "var(--accent)", fontWeight: 500 }}
              >
                🎨 Themes
              </button>
              <a
                className="home-actions-item"
                href="/admin"
                onClick={() => setShowActionsMenu(false)}
              >
                Admin login
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="home-quick-actions">
        <button
          className="home-quick-action-btn"
          onClick={() => openRandomDeck(allDecks)}
          disabled={allDecks.length === 0}
        >
          Shuffle home
        </button>
        <button
          className="home-quick-action-btn"
          onClick={() => {
            setSectionComposerMessage("");
            setSectionComposer({ title: "", description: "" });
          }}
        >
          + New topic
        </button>
      </div>

      <div className="home-search">
        <input
          className="home-search-input"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search decks and cards…"
        />
      </div>

      {showSyncPanel && (
        <div className="panel-card home-panel">
          <div className="panel-card-head">
            <strong>Cloud sync</strong>
            <button className="link-btn" onClick={() => setShowSyncPanel(false)}>
              Close
            </button>
          </div>
          <div className="field">
            <label>Sync key</label>
            <input
              type="text"
              value={syncKeyInput}
              onChange={(e) => onSyncKeyInputChange(e.target.value)}
              placeholder="Private cloud library key"
            />
          </div>
          <p className="hint-text">
            Anyone with this key can access or edit this cloud library. There are no user accounts.
          </p>
          <div className="panel-card-actions">
            <button className="mini-btn" onClick={onApplySyncKey}>
              Use key
            </button>
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
            <button className="mini-btn" onClick={onGenerateSyncKey}>
              New key
            </button>
          </div>
          <p
            className={`message-line${syncState === "error" ? " error" : syncState === "saved" ? " success" : ""}`}
          >
            {syncMessage}
          </p>

          <div className="panel-card-section">
            <strong>Backup file</strong>
            <p className="hint-text">
              A backup is one JSON file holding every topic, deck, card and your progress. Restoring
              adds back anything the backup has that this device is missing; nothing here is
              removed.
            </p>
            <div className="panel-card-actions">
              <button className="mini-btn" onClick={onDownloadBackup}>
                Download backup
              </button>
              <button className="mini-btn" onClick={() => restoreInputRef.current?.click()}>
                Restore from file
              </button>
              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreFileChange}
                hidden
              />
            </div>
            {backupMessage && <p className="message-line">{backupMessage}</p>}
          </div>
        </div>
      )}

      {showThemesPanel && (
        <div className="panel-card home-panel">
          <div className="panel-card-head">
            <strong>Appearance</strong>
            <button className="link-btn" onClick={() => setShowThemesPanel(false)}>
              Close
            </button>
          </div>
          <div style={{ display: "grid", gap: "12px" }}>
            <div>
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                }}
              >
                Theme
              </p>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="mini-btn"
                  onClick={() => setTheme("light")}
                  style={{
                    background: theme === "light" ? "var(--accent)" : "var(--surface)",
                    color: theme === "light" ? "var(--on-accent)" : "var(--ink)",
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
                    color: theme === "dark" ? "var(--on-accent)" : "var(--ink)",
                    borderColor: theme === "dark" ? "var(--accent)" : "var(--line)",
                  }}
                >
                  🌙 Dark
                </button>
              </div>
            </div>
            <div>
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                }}
              >
                Accent color
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(60px, 1fr))",
                  gap: "6px",
                }}
              >
                {ACCENT_COLORS.map((color) => (
                  <button
                    key={color}
                    className="mini-btn"
                    onClick={() => setAccentColor(color)}
                    style={{
                      background: accentColor === color ? `var(--accent)` : "var(--surface)",
                      color: accentColor === color ? "var(--on-accent)" : "var(--ink)",
                      borderColor: accentColor === color ? "var(--accent)" : "var(--line)",
                      fontSize: "11px",
                      textTransform: "capitalize",
                    }}
                  >
                    {ACCENT_EMOJI[color]} {color}
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
              onClick={() => {
                setSectionComposer(null);
                setSectionComposerMessage("");
              }}
            >
              Close
            </button>
          </div>
          <div className="field">
            <label>Topic name</label>
            <input
              type="text"
              value={sectionComposer.title}
              onChange={(e) => setSectionComposer((c) => (c ? { ...c, title: e.target.value } : c))}
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
          {sectionComposerMessage && <p className="message-line error">{sectionComposerMessage}</p>}
          <div className="panel-card-actions">
            <button className="mini-btn" onClick={onCreateSection}>
              Create topic
            </button>
          </div>
        </div>
      )}

      {reviewSummary.totalDue > 0 && !trimmedQuery && (
        <section className="home-reviews" aria-label="Today's reviews">
          <div className="review-summary">
            <div className="review-summary-head">
              <span className="review-summary-count">
                {reviewSummary.totalDue} card{reviewSummary.totalDue === 1 ? "" : "s"} due today
              </span>
              <span className="review-summary-label">Spaced repetition</span>
            </div>
            <div className="review-summary-decks">
              {reviewSummary.decks.slice(0, MAX_REVIEW_DECKS).map(({ deck, section, dueToday }) => (
                <button
                  key={deck.id}
                  className="review-summary-deck"
                  onClick={() => onStartReview(deck.id)}
                >
                  <span className="review-summary-deck-name">{deck.title}</span>
                  <span className="review-summary-deck-meta">
                    {section.title} · {dueToday} due
                  </span>
                </button>
              ))}
            </div>
            {reviewSummary.decks.length > MAX_REVIEW_DECKS && (
              <p className="hint-text">
                and {reviewSummary.decks.length - MAX_REVIEW_DECKS} more deck
                {reviewSummary.decks.length - MAX_REVIEW_DECKS === 1 ? "" : "s"} with cards due.
              </p>
            )}
          </div>
        </section>
      )}

      {dailyCard && !trimmedQuery && (
        <section className="home-daily" aria-label="Deck of the day">
          <div className="daily-card">
            <div className="daily-card-head">
              <span className="daily-card-label">Deck of the day</span>
              {dailyCard.section && (
                <span className="daily-card-source">{dailyCard.section.title}</span>
              )}
            </div>
            <button
              className="daily-card-face"
              onClick={() => openDeck(dailyCard.deck.id)}
              title="Study this deck"
            >
              <span className="daily-card-term">{dailyCard.deck.title}</span>
              <span className="daily-card-hint">
                {dailyCard.deck.subtitle ? `${dailyCard.deck.subtitle} · ` : ""}
                {dailyCard.deck.cards.length} card{dailyCard.deck.cards.length !== 1 ? "s" : ""}
              </span>
            </button>
            <div className="daily-card-actions">
              <button className="mini-btn" onClick={() => openDeck(dailyCard.deck.id)}>
                Study this deck
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="home-main">
        {trimmedQuery ? (
          searchResults.length === 0 ? (
            <div className="empty-state">Nothing matches "{searchQuery}".</div>
          ) : (
            <div className="search-results">
              {searchResults.map((result) =>
                result.kind === "deck" ? (
                  <button
                    key={`deck:${result.deck.id}`}
                    className="search-result-item"
                    onClick={() => openDeck(result.deck.id)}
                  >
                    <div className="search-result-info">
                      <span className="search-result-title">{result.deck.title}</span>
                      <span className="search-result-meta">
                        {result.section.title}
                        {result.deck.subtitle ? ` · ${result.deck.subtitle}` : ""}
                        {` · ${result.deck.cards.length} card${result.deck.cards.length !== 1 ? "s" : ""}`}
                      </span>
                    </div>
                    <span className="section-card-arrow">›</span>
                  </button>
                ) : (
                  <button
                    key={`card:${result.deck.id}:${result.card.id}`}
                    className="search-result-item"
                    onClick={() => openDeck(result.deck.id, result.card.id)}
                    title={result.card.definition}
                  >
                    <div className="search-result-info">
                      <span className="search-result-title">
                        <span className="search-result-kind">Card</span>
                        {result.card.term}
                      </span>
                      <span className="search-result-meta">
                        {result.section.title} · {result.deck.title}
                      </span>
                      <span className="search-result-snippet">{result.card.definition}</span>
                    </div>
                    <span className="section-card-arrow">›</span>
                  </button>
                ),
              )}
              {searchTotal > searchResults.length && (
                <p className="hint-text">
                  Showing the first {MAX_SEARCH_RESULTS} of {searchTotal} matches. Keep typing to
                  narrow them down.
                </p>
              )}
            </div>
          )
        ) : librarySections.length === 0 ? (
          <div className="empty-state">No topics yet. Create one above to get started.</div>
        ) : (
          <>
            {librarySections.length > 1 && (
              <div className="deck-sort-bar">
                <span className="deck-sort-label">Sort</span>
                <div className="deck-sort-toggle" role="group" aria-label="Sort topics">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.mode}
                      className={`deck-sort-btn${sortMode === option.mode ? " active" : ""}`}
                      aria-pressed={sortMode === option.mode}
                      title={option.title}
                      onClick={() => changeSortMode(option.mode)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="sections-grid">
              {orderedSections.map((section) => {
                const cardCount = section.decks.reduce((sum, d) => sum + d.cards.length, 0);
                const sectionLearned = section.decks.reduce(
                  (sum, d) => sum + countLearnedCards(d, deckProgress[d.id]),
                  0,
                );
                return (
                  <button
                    key={section.id}
                    className="section-card"
                    title={section.description || section.title}
                    onClick={() => setView({ kind: "section", sectionId: section.id })}
                  >
                    <div className="section-card-inner">
                      <div className="section-card-text">
                        <div className="section-card-title">{section.title}</div>
                        <div className="section-card-meta">
                          {section.decks.length} deck{section.decks.length !== 1 ? "s" : ""} ·{" "}
                          {cardCount} card{cardCount !== 1 ? "s" : ""}
                          {sectionLearned > 0 ? ` · ${sectionLearned} learned` : ""}
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
          </>
        )}
      </div>

      {recentDecks.length > 0 && (
        <div className="home-recent">
          <div className="home-recent-label">Recently viewed</div>
          <div className="home-recent-list">
            {recentDecks.map(({ deck, section, viewedAt }) => (
              <button key={deck.id} className="home-recent-item" onClick={() => openDeck(deck.id)}>
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
