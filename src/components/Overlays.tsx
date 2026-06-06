import { Deck } from "../data/deckBuilder";
import { AiModal, ConfirmDialog } from "../lib/types";

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
          <button className="danger-btn" onClick={confirmDialog.onConfirm}>Yes, delete</button>
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
