import { Dispatch, SetStateAction } from "react";
import { Deck, DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import { createDeckProgress } from "../lib/deckUtils";
import { DeckComposer, ViewState } from "../lib/types";

type ImportPreview = {
  cards: { term: string; definition: string }[];
  invalidLines: string[];
};

type SectionViewProps = {
  section: DeckSection;
  deckProgress: Record<string, DeckProgress>;
  pinnedDeckIds: string[];
  deckComposer: DeckComposer | null;
  setDeckComposer: Dispatch<SetStateAction<DeckComposer | null>>;
  deckComposerMessage: string;
  setDeckComposerMessage: (message: string) => void;
  deckImportPreview: ImportPreview;
  setView: (view: ViewState) => void;
  openDeck: (deckId: string) => void;
  openRandomDeck: (decks: Deck[]) => void;
  togglePinDeck: (deckId: string) => void;
  onCreateDeck: (sectionId: string) => void;
  onDeleteDeck: (deckId: string) => void;
  onDeleteSection: (sectionId: string) => void;
};

export function SectionView({
  section,
  deckProgress,
  pinnedDeckIds,
  deckComposer,
  setDeckComposer,
  deckComposerMessage,
  setDeckComposerMessage,
  deckImportPreview,
  setView,
  openDeck,
  openRandomDeck,
  togglePinDeck,
  onCreateDeck,
  onDeleteDeck,
  onDeleteSection,
}: SectionViewProps) {
  return (
    <div className="app">
      <header className="topbar">
        <button
          className="topbar-btn topbar-home-btn"
          onClick={() => setView({ kind: "home" })}
          title="Go to home page"
        >
          Home
        </button>
        <div className="top-title">{section.title}</div>
        <div className="topbar-right">
          <button
            className="topbar-btn"
            onClick={() => openRandomDeck(section.decks)}
            disabled={section.decks.length === 0}
            title="Open a random deck from this topic"
          >
            Random deck
          </button>
          <button
            className="topbar-btn"
            onClick={() => {
              setDeckComposerMessage("");
              setDeckComposer({ sectionId: section.id, title: "", subtitle: "", paste: "" });
            }}
          >
            New deck
          </button>
          <button
            className="topbar-btn danger-topbar-btn"
            onClick={() => onDeleteSection(section.id)}
          >
            Delete topic
          </button>
        </div>
      </header>

      <div className="section-view-main">
        {deckComposer?.sectionId === section.id && (
          <div className="panel-card" style={{ marginBottom: 12 }}>
            <div className="panel-card-head">
              <strong>New deck in {section.title}</strong>
              <button
                className="link-btn"
                onClick={() => { setDeckComposer(null); setDeckComposerMessage(""); }}
              >
                Close
              </button>
            </div>
            <div className="field">
              <label>Deck name</label>
              <input
                type="text"
                value={deckComposer.title}
                onChange={(e) =>
                  setDeckComposer((c) => (c ? { ...c, title: e.target.value } : c))
                }
                placeholder="e.g. Common compliments"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Subtitle (optional)</label>
              <input
                type="text"
                value={deckComposer.subtitle}
                onChange={(e) =>
                  setDeckComposer((c) => (c ? { ...c, subtitle: e.target.value } : c))
                }
                placeholder="Optional note about the deck"
              />
            </div>
            <div className="field">
              <label>Paste cards (optional)</label>
              <textarea
                value={deckComposer.paste}
                onChange={(e) =>
                  setDeckComposer((c) => (c ? { ...c, paste: e.target.value } : c))
                }
                placeholder={"adaptable\ttable to adjust easily\nadmirable\tdeserving respect"}
              />
            </div>
            <p className="hint-text">
              Best results: paste Quizlet-style rows with a tab between term and definition.
            </p>
            <div className="import-stats">
              <span>{deckImportPreview.cards.length} cards ready</span>
              <span>{deckImportPreview.invalidLines.length} skipped lines</span>
            </div>
            {deckComposerMessage && (
              <p className="message-line error">{deckComposerMessage}</p>
            )}
            <div className="panel-card-actions">
              <button className="mini-btn" onClick={() => onCreateDeck(section.id)}>
                Create deck
              </button>
            </div>
          </div>
        )}

        {section.decks.length === 0 ? (
          <div className="empty-state">No decks yet. Use New deck to add one.</div>
        ) : (
          <div className="decks-list">
            {section.decks.map((deck) => {
              const progress = deckProgress[deck.id] ?? createDeckProgress(deck);
              const known = progress.knownIds.length;
              const total = deck.cards.length;
              const ratio = total ? known / total : 0;
              return (
                <div key={deck.id} className="deck-card-row">
                  <button
                    className="deck-card"
                    onClick={() => openDeck(deck.id)}
                  >
                    <div className="deck-card-info">
                      <div className="deck-card-title">{deck.title}</div>
                      <div className="deck-card-subtitle">{deck.subtitle}</div>
                      <div className="progress-bar-track">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${ratio * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="deck-card-stats">
                      <span>{total} cards</span>
                      <span>{known} known</span>
                      <span className="section-card-arrow">›</span>
                    </div>
                  </button>
                  <button
                    className={`deck-card-pin${pinnedDeckIds.includes(deck.id) ? " pinned" : ""}`}
                    title={pinnedDeckIds.includes(deck.id) ? "Unpin deck" : "Pin deck"}
                    onClick={() => togglePinDeck(deck.id)}
                  >
                    📌
                  </button>
                  <button
                    className="deck-card-delete"
                    title="Delete deck"
                    onClick={() => onDeleteDeck(deck.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
