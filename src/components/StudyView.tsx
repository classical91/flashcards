import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { Deck, DeckSection, Flashcard } from "../data/deckBuilder";
import { DeckProgress, StudyMode } from "../data/librarySnapshot";
import { ViewState } from "../lib/types";

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
  currentCardIsKnown: boolean;
  hasRemainingCards: boolean;
  isDeckEmpty: boolean;
  isAutoPlaying: boolean;
  setIsAutoPlaying: Dispatch<SetStateAction<boolean>>;
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
  onStudyModeChange: (mode: StudyMode) => void;
  onFlip: () => void;
  onShuffle: () => void;
  onToggleKnown: () => void;
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
};

export function StudyView({
  selectedDeck,
  selectedSection,
  activeProgress,
  currentCard,
  visibleCards,
  cardPosition,
  pinnedDeckIds,
  currentCardIsKnown,
  hasRemainingCards,
  isDeckEmpty,
  isAutoPlaying,
  setIsAutoPlaying,
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
  onStudyModeChange,
  onFlip,
  onShuffle,
  onToggleKnown,
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
}: StudyViewProps) {
  const isPinned = pinnedDeckIds.includes(selectedDeck.id);

  const [deckTitleEdit, setDeckTitleEdit] = useState(selectedDeck.title);
  const [deckSubtitleEdit, setDeckSubtitleEdit] = useState(selectedDeck.subtitle ?? "");

  useEffect(() => {
    setDeckTitleEdit(selectedDeck.title);
    setDeckSubtitleEdit(selectedDeck.subtitle ?? "");
  }, [selectedDeck.id]);
  return (
    <div className="app">
      <header className="topbar">
        <button
          className="topbar-btn"
          onClick={() => setView({ kind: "section", sectionId: selectedSection.id })}
        >
          ‹ Go back
        </button>
        <div className="top-title">
          {selectedDeck.title} · {selectedSection.title}
        </div>
        <div className="topbar-right">
          <button
            className={`topbar-btn topbar-pin-btn${isPinned ? " pinned" : ""}`}
            title={isPinned ? "Unpin deck" : "Pin deck"}
            onClick={() => togglePinDeck(selectedDeck.id)}
          >
            {isPinned ? "📌 Pinned" : "📌 Pin"}
          </button>
          <div className="study-mode-toggle">
            <button
              className={`study-mode-btn${activeProgress.studyMode === "all" ? " active" : ""}`}
              onClick={() => onStudyModeChange("all")}
            >
              All
            </button>
            <button
              className={`study-mode-btn${activeProgress.studyMode === "remaining" ? " active" : ""}`}
              onClick={() => onStudyModeChange("remaining")}
              disabled={!hasRemainingCards}
            >
              Remaining
            </button>
          </div>
        </div>
      </header>

      <section className="stage">
        <div className="study-wrap">
          {currentCard ? (
            <>
              <div className="deck-study-title">{selectedDeck.title}</div>
              {selectedSection && (
                <div className="deck-study-topic">{selectedSection.title}</div>
              )}
              <section className="card-shell-new" aria-live="polite">
                <article
                  className={`card-3d${activeProgress.isFlipped ? " flipped" : ""}`}
                  onClick={onFlip}
                  title="Click to flip the card"
                >
                  <div className="face front">
                    <div className="card-word">{currentCard.term}</div>
                  </div>
                  <div className="face back">
                    <p className="card-definition">{currentCard.definition}</p>
                  </div>
                </article>
              </section>

              <nav className="player" aria-label="Flashcard controls">
                <button className="icon-btn" onClick={onShuffle} title="Shuffle deck">
                  ↭
                </button>
                <button
                  className="icon-btn"
                  onClick={onToggleKnown}
                  title={currentCardIsKnown ? "Unmark known" : "Mark as known"}
                  style={{ color: currentCardIsKnown ? "#2a7d4f" : undefined }}
                >
                  {currentCardIsKnown ? "✓" : "×"}
                </button>
                <button className="circle-btn" onClick={() => onMoveToCard(-1)} title="Previous">
                  ‹
                </button>
                <div className="counter">
                  {cardPosition + 1} / {visibleCards.length}
                </div>
                <button className="circle-btn" onClick={() => onMoveToCard(1)} title="Next">
                  ›
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setIsAutoPlaying((v) => !v)}
                  title="Autoplay"
                >
                  {isAutoPlaying ? "❚❚" : "▶"}
                </button>
                <button className="icon-btn" onClick={onFlip} title="Flip card">
                  ⟳
                </button>
              </nav>

              <section className="deep-tools">
                <div className="deep-title">Deeper understanding tools</div>
                <div className="lookup-bar">
                  <button className="lookup-chip" onClick={() => onGoogleSearch("definition")}>
                    Google definition
                  </button>
                  <button className="lookup-chip" onClick={() => onGoogleSearch("synonyms")}>
                    Google synonyms
                  </button>
                  <button className="lookup-chip" onClick={() => onGoogleSearch("antonyms")}>
                    Google antonyms
                  </button>
                  <button className="lookup-chip" onClick={() => onGoogleSearch("etymology")}>
                    Google etymology
                  </button>
                  <button className="lookup-chip ai" onClick={onShowAiModal}>
                    Ask AI
                  </button>
                </div>
              </section>
            </>
          ) : isDeckEmpty ? (
            <div className="state-card">
              <p>This deck is empty. Add cards using the form below.</p>
            </div>
          ) : (
            <div className="state-card">
              <h3>All done!</h3>
              <p>You&apos;ve worked through every remaining card.</p>
              <div className="state-card-actions">
                <button className="mini-btn" onClick={() => onStudyModeChange("all")}>
                  Review full deck
                </button>
                <button className="mini-btn" onClick={onResetProgress}>
                  Reset progress
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="bottom-panel" aria-label="Deck tools">
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
              />
              <input
                className="deck-info-edit-input"
                value={deckSubtitleEdit}
                onChange={(e) => setDeckSubtitleEdit(e.target.value)}
                placeholder="Subtitle (optional)"
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
                      onChange={(e) =>
                        setCardEdits((prev) => ({
                          ...prev,
                          [card.id]: { term: e.target.value, definition: prev[card.id]?.definition ?? card.definition },
                        }))
                      }
                    />
                    <input
                      className="card-editor-def"
                      value={definition}
                      placeholder="Definition"
                      onChange={(e) =>
                        setCardEdits((prev) => ({
                          ...prev,
                          [card.id]: { term: prev[card.id]?.term ?? card.term, definition: e.target.value },
                        }))
                      }
                      onKeyDown={(e) => { if (e.key === "Enter") onUpdateCard(card.id); }}
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

        <button
          className="mini-btn"
          onClick={() => { setShowCardImporter((v) => !v); setCardImportMessage(""); if (showCardEditor) setShowCardEditor(false); }}
        >
          {showCardImporter ? "Hide import" : "Bulk import"}
        </button>
        <button
          className="mini-btn"
          onClick={() => { setShowCardEditor((v) => !v); setCardEdits({}); if (showCardImporter) { setShowCardImporter(false); setCardImportMessage(""); } }}
        >
          {showCardEditor ? "Hide editor" : "Edit list"}
        </button>
        <button className="mini-btn" onClick={onResetProgress}>Reset</button>
        <button className="mini-btn" onClick={() => setShowCardList(true)} disabled={isDeckEmpty}>
          View all
        </button>
        <button className="mini-btn" onClick={onExportDeck} disabled={isDeckEmpty}>
          Copy cards
        </button>
        {currentCard && (
          <button
            className="mini-btn danger"
            onClick={() => onDeleteCard(currentCard.id)}
          >
            Delete card
          </button>
        )}
        <div className="toast">{toast}</div>
      </section>
    </div>
  );
}
