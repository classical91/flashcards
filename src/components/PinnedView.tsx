import { Deck, DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import { createDeckProgress, findDeckById, findSectionForDeck } from "../lib/deckUtils";
import { ViewState } from "../lib/types";

type PinnedViewProps = {
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  pinnedDeckIds: string[];
  setView: (view: ViewState) => void;
  openDeck: (deckId: string) => void;
  openRandomDeck: (decks: Deck[]) => void;
  togglePinDeck: (deckId: string) => void;
};

export function PinnedView({
  librarySections,
  deckProgress,
  pinnedDeckIds,
  setView,
  openDeck,
  openRandomDeck,
  togglePinDeck,
}: PinnedViewProps) {
  const pinnedDecks = pinnedDeckIds
    .map((id) => {
      const deck = findDeckById(librarySections, id);
      const section = deck ? findSectionForDeck(librarySections, deck.id) : null;
      return deck && section ? { deck, section } : null;
    })
    .filter((entry): entry is { deck: Deck; section: DeckSection } => entry !== null);

  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar-btn" onClick={() => setView({ kind: "home" })}>
          ‹ Home
        </button>
        <div className="top-title">Pinned Decks</div>
        <div className="topbar-right">
          <button
            className="topbar-btn"
            onClick={() => openRandomDeck(pinnedDecks.map((e) => e.deck))}
            disabled={pinnedDecks.length === 0}
            title="Open a random pinned deck"
          >
            Random pinned
          </button>
        </div>
      </header>

      <div className="section-view-main">
        {pinnedDecks.length === 0 ? (
          <div className="empty-state">
            No pinned decks yet. Pin a deck from any topic to see it here.
          </div>
        ) : (
          <div className="decks-list">
            {pinnedDecks.map(({ deck, section }) => {
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
                      <div className="deck-card-subtitle">
                        {section.title} · {deck.subtitle}
                      </div>
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
                    className="deck-card-pin pinned"
                    title="Unpin deck"
                    onClick={() => togglePinDeck(deck.id)}
                  >
                    📌
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
