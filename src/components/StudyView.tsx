import { ComponentPropsWithoutRef, Dispatch, RefObject, SetStateAction, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import { REVIEW_GRADES, ReviewGrade } from "../lib/srs";
import { ViewState } from "../lib/types";
import { AUTOPLAY_SECONDS_OPTIONS } from "../lib/autoplay";
import { Icon } from "./Icons";

const GRADE_LABELS: Record<ReviewGrade, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

// Whether a collapsible section is open is a per-device layout preference,
// so it lives in localStorage rather than the synced library. Sections start
// collapsed.
const DEEP_TOOLS_OPEN_KEY = "flashcards.deepToolsOpen.v1";
const DECK_TOOLS_OPEN_KEY = "flashcards.deckToolsOpen.v1";

// Opening a section scrolls it to the middle of the screen so its buttons are
// in view instead of hidden below the fold. Only a tap scrolls — a section that
// was already open when the page loaded stays where it is.
function usePersistedOpen(storageKey: string, sectionRef: RefObject<HTMLElement>) {
  const justOpened = useRef(false);
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !isOpen;
    justOpened.current = next;
    setIsOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {}
  };
  useEffect(() => {
    if (!isOpen || !justOpened.current) return;
    justOpened.current = false;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [isOpen]);
  return [isOpen, toggle] as const;
}

type CardEdits = Record<string, { term: string; definition: string }>;

type ImportPreview = {
  cards: { term: string; definition: string }[];
  invalidLines: string[];
};

type StudyViewProps = {
  selectedDeck: Deck;
  selectedSection: DeckSection;
  activeProgress: DeckProgress;
  currentCard: Flashcard | null;
  visibleCards: Flashcard[];
  cardPosition: number;
  pinnedDeckIds: string[];
  isDeckEmpty: boolean;
  isAutoPlaying: boolean;
  setIsAutoPlaying: Dispatch<SetStateAction<boolean>>;
  /** Seconds autoplay spends on each side of a card. */
  autoplaySeconds: number;
  onAutoplaySecondsChange: (seconds: number) => void;
  // Card editor / importer panels
  showCardEditor: boolean;
  setShowCardEditor: Dispatch<SetStateAction<boolean>>;
  showCardImporter: boolean;
  setShowCardImporter: Dispatch<SetStateAction<boolean>>;
  cardEdits: CardEdits;
  setCardEdits: Dispatch<SetStateAction<CardEdits>>;
  cardPaste: string;
  setCardPaste: (value: string) => void;
  cardImportMessage: string;
  setCardImportMessage: (value: string) => void;
  cardImportPreview: ImportPreview;
  wordInput: string;
  setWordInput: (value: string) => void;
  defInput: string;
  setDefInput: (value: string) => void;
  toast: string;
  setShowCardList: (value: boolean) => void;
  // Actions
  setView: (view: ViewState) => void;
  togglePinDeck: (deckId: string) => void;
  onFlip: () => void;
  isShuffled: boolean;
  onShuffle: () => void;
  onRestoreOrder: () => void;
  // Review session
  isReviewing: boolean;
  dueCount: number;
  newCount: number;
  /** How long until the next not-yet-ready card returns, e.g. "in 9 min". */
  nextReviewLabel: string | null;
  gradePreview: Record<ReviewGrade, string>;
  onStartReview: () => void;
  onExitReview: () => void;
  onGrade: (grade: ReviewGrade) => void;
  onMoveToCard: (direction: 1 | -1) => void;
  onGoogleSearch: (type: string) => void;
  onShowAiModal: () => void;
  onResetProgress: () => void;
  onAddCards: () => void;
  onAddSingleCard: () => void;
  onDeleteCard: (cardId: string) => void;
  onUpdateCard: (cardId: string) => void;
  onUpdateDeckInfo: (info: { title: string; subtitle: string }) => void;
  onExportDeck: () => void;
  onShareDeck: () => void;
  isSharingDeck: boolean;
};

// A textarea that grows with its text, so a long definition in the card
// editor is readable in full instead of scrolling sideways in a one-line box.
function AutoGrowTextarea(props: ComponentPropsWithoutRef<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { value } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    // The width changes on rotation or resize, which changes the line count.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [value]);

  return <textarea ref={ref} rows={1} {...props} />;
}

export function StudyView({
  selectedDeck,
  selectedSection,
  activeProgress,
  currentCard,
  visibleCards,
  cardPosition,
  pinnedDeckIds,
  isDeckEmpty,
  isAutoPlaying,
  setIsAutoPlaying,
  autoplaySeconds,
  onAutoplaySecondsChange,
  showCardEditor,
  setShowCardEditor,
  showCardImporter,
  setShowCardImporter,
  cardEdits,
  setCardEdits,
  cardPaste,
  setCardPaste,
  cardImportMessage,
  setCardImportMessage,
  cardImportPreview,
  wordInput,
  setWordInput,
  defInput,
  setDefInput,
  toast,
  setShowCardList,
  setView,
  togglePinDeck,
  onFlip,
  isShuffled,
  onShuffle,
  onRestoreOrder,
  isReviewing,
  dueCount,
  newCount,
  nextReviewLabel,
  gradePreview,
  onStartReview,
  onExitReview,
  onGrade,
  onMoveToCard,
  onGoogleSearch,
  onShowAiModal,
  onResetProgress,
  onAddCards,
  onAddSingleCard,
  onDeleteCard,
  onUpdateCard,
  onUpdateDeckInfo,
  onExportDeck,
  onShareDeck,
  isSharingDeck,
}: StudyViewProps) {
  const isPinned = pinnedDeckIds.includes(selectedDeck.id);

  const [deckTitleEdit, setDeckTitleEdit] = useState(selectedDeck.title);
  const [deckSubtitleEdit, setDeckSubtitleEdit] = useState(selectedDeck.subtitle ?? "");

  useEffect(() => {
    setDeckTitleEdit(selectedDeck.title);
    setDeckSubtitleEdit(selectedDeck.subtitle ?? "");
  }, [selectedDeck.id]);

  const toggleImporter = () => {
    setShowCardImporter((v) => !v);
    setCardImportMessage("");
  };

  const toggleEditor = () => {
    setShowCardEditor((v) => !v);
    setCardEdits({});
    if (showCardImporter) {
      setShowCardImporter(false);
      setCardImportMessage("");
    }
  };

  const deepToolsRef = useRef<HTMLElement>(null);
  const deckToolsRef = useRef<HTMLDivElement>(null);
  const [showDeepTools, toggleDeepTools] = usePersistedOpen(DEEP_TOOLS_OPEN_KEY, deepToolsRef);
  const [showDeckTools, toggleDeckTools] = usePersistedOpen(DECK_TOOLS_OPEN_KEY, deckToolsRef);

  const reviewCount = dueCount + newCount;

  return (
    <div className="app study-view">
      <header className="topbar study-topbar">
        <nav className="topbar-left study-topbar-nav" aria-label="Library">
          <button
            className="topbar-btn topbar-home-btn"
            onClick={() => setView({ kind: "home" })}
            title="Go to home page"
          >
            <Icon name="home" size={16} />
            <span>Home</span>
          </button>
          <button
            className="topbar-btn"
            onClick={() => setView({ kind: "section", sectionId: selectedSection.id })}
            title={`Go back to ${selectedSection.title}`}
          >
            <Icon name="decks" size={16} />
            <span>Decks</span>
          </button>
        </nav>
        <div className="top-title">
          {selectedDeck.title} · {selectedSection.title}
        </div>
        <button
          className={`topbar-btn topbar-pin-btn study-topbar-pin${isPinned ? " pinned" : ""}`}
          title={isPinned ? "Unpin deck" : "Pin deck"}
          aria-pressed={isPinned}
          onClick={() => togglePinDeck(selectedDeck.id)}
        >
          <Icon name="pin" size={16} />
          <span>{isPinned ? "Pinned" : "Pin"}</span>
        </button>
        <div className="study-mode-toggle" role="group" aria-label="Study mode">
          <button
            className={`study-mode-btn${!isReviewing ? " active" : ""}`}
            aria-pressed={!isReviewing}
            onClick={onExitReview}
          >
            All
          </button>
          <button
            className={`study-mode-btn${isReviewing ? " active" : ""}`}
            aria-pressed={isReviewing}
            onClick={isReviewing ? onExitReview : onStartReview}
            disabled={isDeckEmpty}
            title="Spaced repetition: cards due today, then ones you have never graded"
          >
            Review
            {reviewCount > 0 && <span className="study-mode-count">{reviewCount}</span>}
          </button>
        </div>
      </header>

      <main className="stage">
        <div className="study-wrap">
          {currentCard ? (
            <>
              <div className="study-heading">
                {selectedSection && <div className="deck-study-topic">{selectedSection.title}</div>}
                <h1 className="deck-study-title">{selectedDeck.title}</h1>
              </div>
              <section className="card-shell-new" aria-live="polite">
                <article
                  className={`card-3d${activeProgress.isFlipped ? " flipped" : ""}`}
                  onClick={onFlip}
                  title="Click to flip the card"
                >
                  <div className="face front">
                    <span className="face-label">Term</span>
                    <div className="face-content">
                      <div className="card-word">{currentCard.term}</div>
                    </div>
                    <span className="face-hint">Tap to flip</span>
                  </div>
                  <div className="face back">
                    <span className="face-label">Definition</span>
                    <div className="face-content">
                      <p className="card-definition">{currentCard.definition}</p>
                    </div>
                  </div>
                </article>
              </section>

              {isReviewing && (
                <div className="grade-row" role="group" aria-label="How well did you know this card?">
                  {REVIEW_GRADES.map((grade, index) => (
                    <button
                      key={grade}
                      className={`grade-btn grade-${grade}`}
                      onClick={() => onGrade(grade)}
                      title={`${GRADE_LABELS[grade]} — keyboard ${index + 1}`}
                    >
                      <span className="grade-btn-label">{GRADE_LABELS[grade]}</span>
                      <span className="grade-btn-interval">{gradePreview[grade]}</span>
                    </button>
                  ))}
                </div>
              )}

              <nav className="player study-toolbar" aria-label="Flashcard controls">
                <button
                  className={`tool-btn tool-shuffle${isShuffled ? " active" : ""}`}
                  onClick={onShuffle}
                  title={
                    isShuffled
                      ? "Shuffled for this session — click to reshuffle (S)"
                      : "Shuffle for this session (S)"
                  }
                  aria-label={isShuffled ? "Reshuffle" : "Shuffle"}
                  aria-pressed={isShuffled}
                >
                  <Icon name="shuffle" />
                </button>
                <button
                  className="tool-btn tool-nav tool-prev"
                  onClick={() => onMoveToCard(-1)}
                  title="Previous (←)"
                  aria-label="Previous card"
                >
                  <Icon name="chevronLeft" size={20} />
                </button>
                <div className="counter" aria-label={`Card ${cardPosition + 1} of ${visibleCards.length}`}>
                  <span className="counter-current">{cardPosition + 1}</span>
                  <span className="counter-sep">/</span>
                  <span>{visibleCards.length}</span>
                </div>
                <button
                  className="tool-btn tool-nav tool-next"
                  onClick={() => onMoveToCard(1)}
                  title="Next (→)"
                  aria-label="Next card"
                >
                  <Icon name="chevronRight" size={20} />
                </button>
                <button
                  className={`tool-btn tool-play${isAutoPlaying ? " active" : ""}`}
                  onClick={() => setIsAutoPlaying((v) => !v)}
                  title={isAutoPlaying ? "Pause autoplay" : "Autoplay"}
                  aria-label={isAutoPlaying ? "Pause autoplay" : "Start autoplay"}
                  aria-pressed={isAutoPlaying}
                >
                  <Icon name={isAutoPlaying ? "pause" : "play"} />
                </button>
                <button
                  className="tool-btn tool-flip"
                  onClick={onFlip}
                  title="Flip card (Space)"
                  aria-label="Flip card"
                >
                  <Icon name="flip" />
                </button>
              </nav>

              {isAutoPlaying && (
                <div className="autoplay-speed" role="group" aria-label="Autoplay seconds per side">
                  <span className="autoplay-speed-label">Seconds per side</span>
                  <div className="autoplay-speed-options">
                    {AUTOPLAY_SECONDS_OPTIONS.map((seconds) => (
                      <button
                        key={seconds}
                        className={`autoplay-speed-btn${seconds === autoplaySeconds ? " active" : ""}`}
                        onClick={() => onAutoplaySecondsChange(seconds)}
                        aria-pressed={seconds === autoplaySeconds}
                        aria-label={`${seconds} seconds per side`}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <section
                ref={deepToolsRef}
                className="study-section deep-tools"
                aria-labelledby="deep-tools-title"
              >
                <h2 className="study-section-title deep-title">
                  <button
                    className="section-toggle"
                    id="deep-tools-title"
                    aria-expanded={showDeepTools}
                    aria-controls="deep-tools-body"
                    onClick={toggleDeepTools}
                  >
                    <span>Deeper Understanding</span>
                    <Icon name="chevronDown" size={16} />
                  </button>
                </h2>
                {showDeepTools && (
                  <div id="deep-tools-body" className="deep-tools-body">
                    <div className="lookup-bar">
                      <button
                        className="lookup-chip"
                        onClick={() => onGoogleSearch("definition")}
                        title={`Search Google for the definition of "${currentCard.term}"`}
                        aria-label="Google definition"
                      >
                        <Icon name="book" size={16} />
                        <span>Definition</span>
                      </button>
                      <button
                        className="lookup-chip"
                        onClick={() => onGoogleSearch("synonyms")}
                        title={`Search Google for synonyms of "${currentCard.term}"`}
                        aria-label="Google synonyms"
                      >
                        <Icon name="equals" size={16} />
                        <span>Synonyms</span>
                      </button>
                      <button
                        className="lookup-chip"
                        onClick={() => onGoogleSearch("antonyms")}
                        title={`Search Google for antonyms of "${currentCard.term}"`}
                        aria-label="Google antonyms"
                      >
                        <Icon name="opposite" size={16} />
                        <span>Antonyms</span>
                      </button>
                      <button
                        className="lookup-chip"
                        onClick={() => onGoogleSearch("etymology")}
                        title={`Search Google for the etymology of "${currentCard.term}"`}
                        aria-label="Google etymology"
                      >
                        <Icon name="history" size={16} />
                        <span>Etymology</span>
                      </button>
                      <button
                        className="lookup-chip ai"
                        onClick={onShowAiModal}
                        title={`Ask an AI app how to use "${currentCard.term}"`}
                      >
                        <Icon name="sparkles" size={16} />
                        <span>Ask AI</span>
                      </button>
                    </div>
                    <p className="lookup-note">Lookups open a Google search in a new tab.</p>
                  </div>
                )}
              </section>
            </>
          ) : isDeckEmpty ? (
            <div className="state-card">
              <p>This deck is empty. Add cards using the form below.</p>
              <div className="state-card-actions">
                {!showCardEditor && (
                  <button className="mini-btn primary" onClick={toggleEditor}>
                    Edit list
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="state-card">
              <h3>{nextReviewLabel ? "Nothing ready yet" : "All done!"}</h3>
              <p>
                {nextReviewLabel
                  ? `The next card comes back ${nextReviewLabel}.`
                  : "Nothing left to review in this deck today."}
              </p>
              <div className="state-card-actions">
                <button className="mini-btn" onClick={onExitReview}>
                  Back to the full deck
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <section className="bottom-panel" aria-label="Deck tools">
        <div ref={deckToolsRef} className="study-section deck-tools">
          <h2 className="study-section-title">
            <button
              className="section-toggle"
              aria-expanded={showDeckTools}
              aria-controls="deck-tools-body"
              onClick={toggleDeckTools}
            >
              <span>Deck Tools</span>
              <Icon name="chevronDown" size={16} />
            </button>
          </h2>
          {showDeckTools && (
            <div id="deck-tools-body" className="deck-tools-body">
              <div className="bottom-bar deck-tools-grid">
                <button
                  className={`deck-tool-btn${showCardImporter ? " active" : ""}`}
                  onClick={toggleImporter}
                  aria-pressed={showCardImporter}
                >
                  <Icon name="upload" size={16} />
                  <span>{showCardImporter ? "Hide import" : "Bulk import"}</span>
                </button>
                <button className="deck-tool-btn" onClick={onResetProgress} title="Reset progress">
                  <Icon name="reset" size={16} />
                  <span>Reset</span>
                </button>
                {isShuffled && (
                  <button
                    className="deck-tool-btn"
                    onClick={onRestoreOrder}
                    title="Return the deck to its own order"
                  >
                    <Icon name="sortAsc" size={16} />
                    <span>Unshuffle</span>
                  </button>
                )}
                <button
                  className="deck-tool-btn"
                  onClick={() => setShowCardList(true)}
                  disabled={isDeckEmpty}
                  title="View all cards"
                >
                  <Icon name="list" size={16} />
                  <span>View all</span>
                </button>
                <button
                  className="deck-tool-btn"
                  onClick={onExportDeck}
                  disabled={isDeckEmpty}
                  title="Copy cards to the clipboard"
                >
                  <Icon name="copy" size={16} />
                  <span>Copy cards</span>
                </button>
                <button
                  className="deck-tool-btn"
                  onClick={onShareDeck}
                  disabled={isDeckEmpty || isSharingDeck}
                  aria-busy={isSharingDeck}
                >
                  <Icon name="share" size={16} />
                  <span>{isSharingDeck ? "Sharing…" : "Share deck"}</span>
                </button>
                <button
                  className={`deck-tool-btn${showCardEditor ? " active" : ""}`}
                  onClick={toggleEditor}
                  aria-pressed={showCardEditor}
                >
                  <Icon name="edit" size={16} />
                  <span>{showCardEditor ? "Hide editor" : "Edit list"}</span>
                </button>
                <button
                  className="deck-tool-btn danger"
                  onClick={() => currentCard && onDeleteCard(currentCard.id)}
                  disabled={!currentCard}
                  title={currentCard ? `Delete "${currentCard.term}"` : "No card is showing"}
                >
                  <Icon name="trash" size={16} />
                  <span>Delete card</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {showCardEditor && (
          <div className="card-editor-panel">
            <div className="panel-card-head">
              <strong>Edit cards ({selectedDeck.cards.length})</strong>
              <button
                className="link-btn"
                onClick={() => { setShowCardEditor(false); setCardEdits({}); }}
              >
                Close
              </button>
            </div>
            <div className="deck-info-edit">
              <input
                className="deck-info-edit-input"
                value={deckTitleEdit}
                onChange={(e) => setDeckTitleEdit(e.target.value)}
                placeholder="Deck name"
                aria-label="Deck name"
              />
              <input
                className="deck-info-edit-input"
                value={deckSubtitleEdit}
                onChange={(e) => setDeckSubtitleEdit(e.target.value)}
                placeholder="Subtitle (optional)"
                aria-label="Deck subtitle"
              />
              <button
                className="mini-btn"
                onClick={() => onUpdateDeckInfo({ title: deckTitleEdit.trim(), subtitle: deckSubtitleEdit.trim() })}
                disabled={
                  !deckTitleEdit.trim() ||
                  (deckTitleEdit.trim() === selectedDeck.title &&
                    deckSubtitleEdit.trim() === (selectedDeck.subtitle ?? ""))
                }
              >
                Save name
              </button>
            </div>
            <div className="add-card-form">
              <input
                value={wordInput}
                onChange={(e) => setWordInput(e.target.value)}
                placeholder="Word..."
                aria-label="New card word"
                onKeyDown={(e) => {
                  if (e.key === "Enter") document.getElementById("study-def-input")?.focus();
                }}
              />
              <input
                id="study-def-input"
                className="wide"
                value={defInput}
                onChange={(e) => setDefInput(e.target.value)}
                placeholder="Definition..."
                aria-label="New card definition"
                onKeyDown={(e) => { if (e.key === "Enter") onAddSingleCard(); }}
              />
              <button className="mini-btn" onClick={onAddSingleCard}>Add</button>
            </div>
            <div className="card-editor-list">
              {selectedDeck.cards.map((card) => {
                const edit = cardEdits[card.id];
                const term = edit ? edit.term : card.term;
                const definition = edit ? edit.definition : card.definition;
                const isDirty = !!edit;
                return (
                  <div key={card.id} className="card-editor-row">
                    <input
                      className="card-editor-term"
                      value={term}
                      placeholder="Term"
                      aria-label={`Term for ${card.term}`}
                      onChange={(e) =>
                        setCardEdits((prev) => ({
                          ...prev,
                          [card.id]: { term: e.target.value, definition: prev[card.id]?.definition ?? card.definition },
                        }))
                      }
                    />
                    <AutoGrowTextarea
                      className="card-editor-def"
                      value={definition}
                      placeholder="Definition"
                      aria-label={`Definition for ${card.term}`}
                      onChange={(e) =>
                        setCardEdits((prev) => ({
                          ...prev,
                          [card.id]: { term: prev[card.id]?.term ?? card.term, definition: e.target.value },
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); onUpdateCard(card.id); }
                      }}
                    />
                    <button
                      className={`mini-btn${isDirty ? " primary" : ""}`}
                      disabled={!isDirty}
                      onClick={() => onUpdateCard(card.id)}
                      title="Save changes"
                    >
                      Save
                    </button>
                    <button
                      className="mini-btn danger"
                      onClick={() => onDeleteCard(card.id)}
                      title="Delete card"
                      aria-label={`Delete ${card.term}`}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showCardImporter && (
          <div className="bulk-import-panel">
            <div className="panel-card-head">
              <strong>Bulk import cards</strong>
              <button
                className="link-btn"
                onClick={() => { setShowCardImporter(false); setCardImportMessage(""); }}
              >
                Close
              </button>
            </div>
            <div className="field">
              <textarea
                value={cardPaste}
                onChange={(e) => setCardPaste(e.target.value)}
                aria-label="Cards to import, one per line"
                placeholder={"adaptable\ttable to adjust easily\nadmirable\tdeserving respect"}
              />
            </div>
            <div className="import-stats">
              <span>{cardImportPreview.cards.length} cards ready</span>
              <span>{cardImportPreview.invalidLines.length} skipped</span>
            </div>
            {cardImportMessage && (
              <p
                className={`message-line${cardImportMessage.startsWith("Added") ? " success" : " error"}`}
              >
                {cardImportMessage}
              </p>
            )}
            <div className="panel-card-actions">
              <button className="mini-btn" onClick={onAddCards}>
                Add pasted cards
              </button>
            </div>
          </div>
        )}

        <div className="toast" role="status">{toast}</div>
      </section>
    </div>
  );
}
