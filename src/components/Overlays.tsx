import { Deck } from "../data/deckBuilder";
import { AiModal, ConfirmDialog, SharedDeckLink } from "../lib/types";

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
  onClose: () => void;
};

export function CardListOverlay({ show, selectedDeck, onClose }: CardListOverlayProps) {
  if (!show || !selectedDeck) return null;
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
        <div className="card-list-scroll">
          {selectedDeck.cards.map((card, i) => (
            <div key={card.id} className="card-list-row">
              <span className="card-list-index">{i + 1}</span>
              <span className="card-list-term">{card.term}</span>
              <span className="card-list-def">{card.definition}</span>
            </div>
          ))}
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
