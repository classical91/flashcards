import { useState } from "react";
import { Deck } from "../data/deckBuilder";
import { AiModal, ConfirmDialog, SharedDeckLink } from "../lib/types";
import { Icon } from "./Icons";

type ConfirmOverlayProps = {
  confirmDialog: ConfirmDialog | null;
  onCancel: () => void;
};

export function ConfirmOverlay({ confirmDialog, onCancel }: ConfirmOverlayProps) {
  if (!confirmDialog) return null;
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true">
      <div className="confirm-box">
        <p>{confirmDialog.message}</p>
        <div className="confirm-actions">
          <button className="mini-btn" onClick={onCancel}>Cancel</button>
          <button
            className={confirmDialog.tone === "primary" ? "mini-btn primary" : "danger-btn"}
            onClick={confirmDialog.onConfirm}
          >
            {confirmDialog.confirmLabel ?? "Yes, delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

type AiOverlayProps = {
  aiModal: AiModal;
  onClose: () => void;
  onOpenAI: (provider: "chatgpt" | "claude" | "gemini") => void;
};

export function AiOverlay({ aiModal, onClose, onOpenAI }: AiOverlayProps) {
  if (!aiModal) return null;
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section className="modal">
        <h2>Ask AI about &ldquo;{aiModal.word}&rdquo;?</h2>
        <p>
          This will copy a prompt asking how to use the word naturally in a sentence. Then
          choose which AI app to open.
        </p>
        <div className="prompt-preview">{aiModal.prompt}</div>
        <div className="modal-actions">
          <button className="mini-btn" onClick={onClose}>Cancel</button>
          <button className="mini-btn" onClick={() => onOpenAI("chatgpt")}>Open ChatGPT</button>
          <button className="mini-btn" onClick={() => onOpenAI("claude")}>Open Claude</button>
          <button className="mini-btn" onClick={() => onOpenAI("gemini")}>Open Gemini</button>
        </div>
      </section>
    </div>
  );
}

type CardListOverlayProps = {
  show: boolean;
  selectedDeck: Deck | null;
  starredCardIds: Set<string>;
  /** Opens on the starred filter, e.g. when the starred list is being studied. */
  initialStarredOnly: boolean;
  onToggleStar: (cardId: string) => void;
  onStudyStarred: () => void;
  onClose: () => void;
};

export function CardListOverlay({
  show,
  selectedDeck,
  starredCardIds,
  initialStarredOnly,
  onToggleStar,
  onStudyStarred,
  onClose,
}: CardListOverlayProps) {
  const [starredOnly, setStarredOnly] = useState(initialStarredOnly);
  if (!show || !selectedDeck) return null;
  // Numbers stay the card's place in the deck, so the starred list still says
  // where each word lives.
  const rows = selectedDeck.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !starredOnly || starredCardIds.has(card.id));
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section className="modal card-list-modal">
        <div className="panel-card-head">
          <strong>{selectedDeck.title} &mdash; {selectedDeck.cards.length} card{selectedDeck.cards.length !== 1 ? "s" : ""}</strong>
          <button className="link-btn" onClick={onClose}>Close</button>
        </div>
        <div className="card-list-filters">
          <div className="card-list-tabs" role="group" aria-label="Which cards to list">
            <button
              className={`card-list-tab${!starredOnly ? " active" : ""}`}
              aria-pressed={!starredOnly}
              onClick={() => setStarredOnly(false)}
            >
              All
            </button>
            <button
              className={`card-list-tab${starredOnly ? " active" : ""}`}
              aria-pressed={starredOnly}
              onClick={() => setStarredOnly(true)}
            >
              <Icon name="star" size={13} filled />
              Starred ({starredCardIds.size})
            </button>
          </div>
          {starredOnly && !initialStarredOnly && starredCardIds.size > 0 && (
            <button className="mini-btn" onClick={onStudyStarred}>
              Study starred
            </button>
          )}
        </div>
        <div className="card-list-scroll">
          {rows.length === 0 && (
            <p className="card-list-empty">
              No starred cards yet. Tap a star beside a word to add it here.
            </p>
          )}
          {rows.map(({ card, index }) => {
            const isStarred = starredCardIds.has(card.id);
            return (
              <div key={card.id} className="card-list-row">
                <span className="card-list-index">{index + 1}</span>
                <span className="card-list-term">{card.term}</span>
                <span className="card-list-def">{card.definition}</span>
                <button
                  className={`card-list-star${isStarred ? " starred" : ""}`}
                  onClick={() => onToggleStar(card.id)}
                  title={isStarred ? "Remove from starred" : "Add to starred"}
                  aria-label={`${isStarred ? "Remove" : "Add"} ${card.term} ${isStarred ? "from" : "to"} starred`}
                  aria-pressed={isStarred}
                >
                  <Icon name="star" size={16} filled={isStarred} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

type SharedDeckOverlayProps = {
  sharedDeckLink: SharedDeckLink | null;
  onImport: () => void;
  onDismiss: () => void;
};

/**
 * Prompt shown after following a `/d/<shareId>` link. The deck is previewed
 * before anything is written, so a link from a stranger cannot quietly grow
 * the reader's library.
 */
export function SharedDeckOverlay({ sharedDeckLink, onImport, onDismiss }: SharedDeckOverlayProps) {
  if (!sharedDeckLink) return null;

  if (sharedDeckLink.status !== "ready") {
    const isError = sharedDeckLink.status === "error";
    return (
      <div
        className="modal-overlay"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) onDismiss();
        }}
      >
        <section className="modal">
          <h2>{isError ? "That shared deck could not be opened" : "Opening shared deck…"}</h2>
          <p>{isError ? sharedDeckLink.message : "Fetching the deck someone shared with you."}</p>
          {isError && (
            <div className="modal-actions">
              <button className="mini-btn" onClick={onDismiss}>
                Close
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const { deck, section } = sharedDeckLink.snapshot;
  const preview = deck.cards.slice(0, 5);
  const remaining = deck.cards.length - preview.length;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <section className="modal">
        <h2>Add &ldquo;{deck.title}&rdquo; to your library?</h2>
        <p>
          Someone shared this deck with you &mdash; {deck.cards.length} card
          {deck.cards.length === 1 ? "" : "s"}, filed under {section.title}. It will be added as
          your own copy, so your edits and progress stay yours.
        </p>
        {preview.length > 0 && (
          <div className="card-list-scroll shared-deck-preview">
            {preview.map((card, i) => (
              <div key={card.id} className="card-list-row">
                <span className="card-list-index">{i + 1}</span>
                <span className="card-list-term">{card.term}</span>
                <span className="card-list-def">{card.definition}</span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="card-list-row shared-deck-more">
                <span className="card-list-def">
                  and {remaining} more card{remaining === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button className="mini-btn" onClick={onDismiss}>
            Not now
          </button>
          <button className="mini-btn" onClick={onImport}>
            Add to my library
          </button>
        </div>
      </section>
    </div>
  );
}
