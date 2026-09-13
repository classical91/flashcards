import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  Deck,
  DeckSection,
  createUniqueId,
  parsePastedFlashcards,
  withCardIds,
} from "./data/deckBuilder";
import { createLibrarySnapshot } from "./data/librarySnapshot";
import {
  ACCENT_STORAGE_KEY,
  DAILY_CARD_STORAGE_KEY,
  DECK_LAST_VIEWED_STORAGE_KEY,
  LIBRARY_STORAGE_KEY,
  MAX_RECENT_DECKS,
  PINNED_DECKS_STORAGE_KEY,
  PREFERENCES_UPDATED_AT_STORAGE_KEY,
  PROGRESS_STORAGE_KEY,
  RECENT_DECKS_STORAGE_KEY,
  SELECTED_DECK_STORAGE_KEY,
  THEME_STORAGE_KEY,
  TOMBSTONES_STORAGE_KEY,
} from "./lib/constants";
import {
  createDeckProgress,
  resetDeckProgress,
  findDeckById,
  findSectionForDeck,
  applyStudyOrder,
  flattenDecks,
  shuffleCards,
  touchCard,
  touchDeck,
  touchKnownCard,
  touchProgress,
  touchSection,
  updateDeckInSections,
} from "./lib/deckUtils";
import { LibraryState, mergeLibraryState } from "./lib/merge";
import {
  ReviewGrade,
  buildReviewQueue,
  countReviewQueue,
  formatTimeUntil,
  gradeCard,
  nextReviewDueAt,
  previewIntervals,
} from "./lib/srs";
import {
  collectEntityIds,
  forgetDeletions,
  recordCardDeletion,
  recordDeckDeletion,
  recordSectionDeletion,
} from "./lib/tombstones";
import {
  buildBackupFileName,
  countBackupCards,
  downloadTextFile,
  readBackup,
  serializeBackup,
} from "./lib/backup";
import { DailyCardRef, pickDailyCard, toDateKey } from "./lib/dailyCard";
import {
  loadAccentColor,
  loadDailyCard,
  loadDeckLastViewed,
  loadLibrarySections,
  loadPinnedDeckIds,
  loadProgressState,
  loadPreferencesUpdatedAt,
  loadRecentDeckIds,
  loadSelectedDeckId,
  loadTheme,
  loadTombstones,
  safeSetItem,
} from "./lib/storage";
import {
  AccentColor,
  AiModal,
  ConfirmDialog,
  DeckComposer,
  DeckLastViewed,
  DeckProgress,
  RecentDeckEntry,
  SectionComposer,
  SectionEditor,
  SharedDeckLink,
  StudyMode,
  SyncedPreferences,
  Theme,
  ViewState,
} from "./lib/types";
import { DECK_LINK_WAIT_MS, DeckLink, getDeckLinkFromSearch } from "./lib/deckLink";
import {
  buildShareUrl,
  createSharedDeck,
  fetchSharedDeck,
  getShareIdFromPath,
  importSharedDeck,
} from "./lib/share";
import { useCloudSync } from "./hooks/useCloudSync";
import { useDebouncedPersist } from "./hooks/useDebouncedPersist";
import { useStudyKeyboard } from "./hooks/useStudyKeyboard";
import {
  AiOverlay,
  CardListOverlay,
  ConfirmOverlay,
  SharedDeckOverlay,
} from "./components/Overlays";
import { HomeView } from "./components/HomeView";
import { PinnedView } from "./components/PinnedView";
import { SectionView } from "./components/SectionView";
import { StudyView } from "./components/StudyView";

export default function App() {
  const [librarySections, setLibrarySections] = useState(loadLibrarySections);
  const [deckProgress, setDeckProgress] = useState(() => loadProgressState(librarySections));
  const [selectedDeckId, setSelectedDeckId] = useState(loadSelectedDeckId);
  const [deckComposer, setDeckComposer] = useState<DeckComposer | null>(null);
  const [deckComposerMessage, setDeckComposerMessage] = useState("");
  const [showCardImporter, setShowCardImporter] = useState(false);
  const [cardPaste, setCardPaste] = useState("");
  const [cardImportMessage, setCardImportMessage] = useState("");
  const [showCardEditor, setShowCardEditor] = useState(false);
  const [showCardList, setShowCardList] = useState(false);
  const [cardEdits, setCardEdits] = useState<Record<string, { term: string; definition: string }>>(
    {},
  );
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [sectionComposer, setSectionComposer] = useState<SectionComposer | null>(null);
  const [sectionComposerMessage, setSectionComposerMessage] = useState("");
  const [sectionEditor, setSectionEditor] = useState<SectionEditor | null>(null);
  const [sectionEditorMessage, setSectionEditorMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [sharedDeckLink, setSharedDeckLink] = useState<SharedDeckLink | null>(null);
  // A `?deck=<id>` link that has not landed yet — see the effects near
  // getDeckLinkFromSearch for why it waits rather than resolving on mount.
  const [pendingDeckLink, setPendingDeckLink] = useState<DeckLink | null>(null);
  const [isSharingDeck, setIsSharingDeck] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [showThemesPanel, setShowThemesPanel] = useState(false);
  const [view, setView] = useState<ViewState>({ kind: "home" });
  const [toast, setToast] = useState(
    "Flashcard = word on the front, definition on the back. Google/AI tools are separate for deeper understanding.",
  );
  const [aiModal, setAiModal] = useState<AiModal>(null);
  const [wordInput, setWordInput] = useState("");
  const [defInput, setDefInput] = useState("");
  const [pinnedDeckIds, setPinnedDeckIds] = useState<string[]>(loadPinnedDeckIds);
  const [recentDeckIds, setRecentDeckIds] = useState<RecentDeckEntry[]>(loadRecentDeckIds);
  const [deckLastViewed, setDeckLastViewed] = useState<DeckLastViewed>(loadDeckLastViewed);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [accentColor, setAccentColor] = useState<AccentColor>(loadAccentColor);
  const [dailyCardRef, setDailyCardRef] = useState<DailyCardRef | null>(loadDailyCard);
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));
  // Session-only: a shuffle is a way to study, not an edit to the deck, so it
  // is deliberately never persisted or synced. Keyed by deck so returning to a
  // deck you shuffled keeps that order for the rest of the session.
  const [studyOrder, setStudyOrder] = useState<{ deckId: string; cardIds: string[] } | null>(null);
  // A review session is also session-only. `reviewNow` is the clock the queue
  // is measured against; it ticks while a session is running so a card put off
  // for ten minutes reappears when those ten minutes are actually up.
  const [reviewDeckId, setReviewDeckId] = useState<string | null>(null);
  const [reviewNow, setReviewNow] = useState(() => Date.now());
  const [tombstones, setTombstones] = useState(loadTombstones);
  const [preferencesUpdatedAt, setPreferencesUpdatedAt] = useState(loadPreferencesUpdatedAt);

  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const preferences = useMemo<SyncedPreferences>(
    () => ({
      pinnedDeckIds,
      recentDecks: recentDeckIds,
      deckLastViewed,
      theme,
      accentColor,
      updatedAt: preferencesUpdatedAt,
    }),
    [pinnedDeckIds, recentDeckIds, deckLastViewed, theme, accentColor, preferencesUpdatedAt],
  );

  const libraryState = useMemo<LibraryState>(
    () => ({ librarySections, deckProgress, tombstones, preferences }),
    [librarySections, deckProgress, tombstones, preferences],
  );

  // Applies a completed cloud merge in one pass. Preferences are written back
  // with the merge's own timestamp rather than through the UI setters below,
  // so accepting the cloud's theme doesn't count as this device changing it.
  const applyMergedState = (merged: LibraryState, mergedSelectedDeckId: string) => {
    setLibrarySections(merged.librarySections);
    setDeckProgress(merged.deckProgress);
    setTombstones(merged.tombstones);
    setPinnedDeckIds(merged.preferences.pinnedDeckIds);
    setRecentDeckIds(merged.preferences.recentDecks);
    setDeckLastViewed(merged.preferences.deckLastViewed);
    setTheme(merged.preferences.theme);
    setAccentColor(merged.preferences.accentColor);
    setPreferencesUpdatedAt(merged.preferences.updatedAt);
    setSelectedDeckId(mergedSelectedDeckId);
  };

  const cloudSync = useCloudSync({ libraryState, selectedDeckId, applyMergedState });

  // Marks the preference group (pins, theme, accent) as changed on this device
  // so the merge prefers it over another device's older settings.
  const touchPreferences = () => setPreferencesUpdatedAt(Date.now());

  const chooseTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    touchPreferences();
  };

  const chooseAccentColor = (nextAccent: AccentColor) => {
    setAccentColor(nextAccent);
    touchPreferences();
  };

  const askConfirm = (
    message: string,
    onConfirm: () => void,
    options: Pick<ConfirmDialog, "confirmLabel" | "tone"> = {},
  ) => {
    setConfirmDialog({ message, onConfirm, ...options });
  };

  const allDecks = useMemo(() => flattenDecks(librarySections), [librarySections]);

  const selectedDeck = useMemo(
    () => findDeckById(librarySections, selectedDeckId) ?? allDecks[0] ?? null,
    [librarySections, selectedDeckId, allDecks],
  );

  const selectedSection = useMemo(
    () =>
      selectedDeck
        ? findSectionForDeck(librarySections, selectedDeck.id)
        : (librarySections[0] ?? null),
    [selectedDeck, librarySections],
  );

  const activeProgress = useMemo(
    () =>
      selectedDeck ? (deckProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck)) : null,
    [selectedDeck, deckProgress],
  );

  const knownSet = useMemo(() => new Set(activeProgress?.knownIds ?? []), [activeProgress]);

  const isShuffled = !!selectedDeck && studyOrder?.deckId === selectedDeck.id;
  const isReviewing = !!selectedDeck && reviewDeckId === selectedDeck.id;

  const orderedCards = useMemo(
    () =>
      selectedDeck
        ? applyStudyOrder(selectedDeck.cards, isShuffled ? (studyOrder?.cardIds ?? null) : null)
        : [],
    [selectedDeck, isShuffled, studyOrder],
  );

  const visibleCards = useMemo(() => {
    if (isReviewing) {
      return buildReviewQueue(orderedCards, activeProgress?.reviews, reviewNow);
    }
    return activeProgress?.studyMode === "remaining"
      ? orderedCards.filter((card) => !knownSet.has(card.id))
      : orderedCards;
  }, [orderedCards, activeProgress?.studyMode, activeProgress?.reviews, knownSet, isReviewing, reviewNow]);

  const deckReviewCounts = useMemo(
    () =>
      selectedDeck
        ? countReviewQueue(
            selectedDeck.cards.map((card) => card.id),
            activeProgress?.reviews,
            reviewNow,
          )
        : { due: 0, later: 0, newCards: 0 },
    [selectedDeck, activeProgress?.reviews, reviewNow],
  );

  // Only meaningful once the queue has run dry: the session says when the card
  // it just deferred is coming back, rather than claiming the deck is finished.
  const nextReviewLabel = useMemo(() => {
    if (!selectedDeck) return null;
    const due = nextReviewDueAt(
      selectedDeck.cards.map((card) => card.id),
      activeProgress?.reviews,
      reviewNow,
    );
    return due === null ? null : formatTimeUntil(due, reviewNow);
  }, [selectedDeck, activeProgress?.reviews, reviewNow]);

  const currentCard = useMemo(
    () =>
      visibleCards.find((card) => card.id === activeProgress?.currentCardId) ??
      visibleCards[0] ??
      null,
    [visibleCards, activeProgress?.currentCardId],
  );

  const cardPosition = useMemo(
    () => (currentCard ? visibleCards.findIndex((card) => card.id === currentCard.id) : -1),
    [currentCard, visibleCards],
  );

  const gradePreview = useMemo(
    () => previewIntervals(currentCard ? activeProgress?.reviews?.[currentCard.id] : undefined),
    [currentCard, activeProgress?.reviews],
  );

  const totalCards = selectedDeck?.cards.length ?? 0;
  const knownCount = activeProgress?.knownIds.length ?? 0;
  const remainingCount = totalCards - knownCount;
  const hasRemainingCards = remainingCount > 0;
  const currentCardIsKnown = currentCard ? knownSet.has(currentCard.id) : false;
  const isDeckEmpty = totalCards === 0;

  /**
   * What the whole library has waiting today, for the home page. Only decks
   * with something due are listed: a deck whose cards have never been graded
   * is not "overdue", it just hasn't been started.
   */
  const reviewSummary = useMemo(() => {
    const decks = librarySections
      .flatMap((section) =>
        section.decks.map((deck) => ({
          deck,
          section,
          ...countReviewQueue(
            deck.cards.map((card) => card.id),
            deckProgress[deck.id]?.reviews,
          ),
        })),
      )
      // `later` counts cards scheduled for the rest of today — mostly ones
      // just answered Again — so the dashboard reports the whole day's work
      // even though the study queue only offers what is ready now.
      .map((entry) => ({ ...entry, dueToday: entry.due + entry.later }))
      .filter((entry) => entry.dueToday > 0)
      .sort((a, b) => b.dueToday - a.dueToday);

    return { totalDue: decks.reduce((sum, entry) => sum + entry.dueToday, 0), decks };
    // todayKey rolls the counts over at midnight on a tab left open overnight.
  }, [librarySections, deckProgress, todayKey]);

  // The picked card is stored by id, so resolve it against the live library —
  // that way a deck deleted mid-day just retires the pick instead of dangling.
  const dailyCard = useMemo(() => {
    if (!dailyCardRef || dailyCardRef.dateKey !== todayKey) return null;
    const deck = findDeckById(librarySections, dailyCardRef.deckId);
    const card = deck?.cards.find((c) => c.id === dailyCardRef.cardId);
    if (!deck || !card) return null;
    return { deck, card, section: findSectionForDeck(librarySections, deck.id) };
  }, [dailyCardRef, todayKey, librarySections]);

  // Only runs during a review session, and only often enough that a ten-minute
  // step feels prompt without re-rendering the card every second.
  useEffect(() => {
    if (!isReviewing) return;
    const timer = window.setInterval(() => setReviewNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [isReviewing]);

  // Keeps a tab left open overnight honest about which day it is.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTodayKey((current) => {
        const next = toDateKey(new Date());
        return next === current ? current : next;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Picks once per day and then leaves it alone: the effect exits early as
  // soon as the stored pick resolves, so marking it known won't reroll it.
  useEffect(() => {
    if (dailyCard) return;
    const next = pickDailyCard(librarySections, deckProgress, todayKey);
    if (next) setDailyCardRef(next);
  }, [dailyCard, librarySections, deckProgress, todayKey]);

  const deckImportPreview = useMemo(
    () =>
      deckComposer?.paste
        ? parsePastedFlashcards(deckComposer.paste)
        : { cards: [], invalidLines: [] },
    [deckComposer?.paste],
  );

  const cardImportPreview = useMemo(
    () => (cardPaste ? parsePastedFlashcards(cardPaste) : { cards: [], invalidLines: [] }),
    [cardPaste],
  );

  /**
   * `position: true` means the user moved through the deck or changed study
   * mode. Flipping a card is not a move, and neither is reconciliation after
   * the library changes — stamping those would make one device's idle
   * navigation look newer than another's actual work.
   */
  const updateSelectedDeckProgress = (
    updater: (progress: DeckProgress) => DeckProgress,
    { position = false }: { position?: boolean } = {},
  ) => {
    if (!selectedDeck) return;
    setDeckProgress((currentProgress) => {
      const nextProgress = updater(
        currentProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck),
      );
      return { ...currentProgress, [selectedDeck.id]: touchProgress(nextProgress, { position }) };
    });
  };

  const handleFlip = () => {
    updateSelectedDeckProgress((progress) => ({ ...progress, isFlipped: !progress.isFlipped }));
  };

  const moveToCard = (direction: 1 | -1) => {
    if (!currentCard || !selectedDeck || !activeProgress || !visibleCards.length) return;
    const nextIndex = (cardPosition + direction + visibleCards.length) % visibleCards.length;
    updateSelectedDeckProgress(
      (progress) => ({
        ...progress,
        currentCardId: visibleCards[nextIndex].id,
        isFlipped: false,
      }),
      { position: true },
    );
  };

  const handleFlipRef = useRef(handleFlip);
  handleFlipRef.current = handleFlip;
  const moveToCardRef = useRef(moveToCard);
  moveToCardRef.current = moveToCard;

  const handleShuffle = () => {
    if (!selectedDeck) return;
    setStudyOrder({
      deckId: selectedDeck.id,
      cardIds: shuffleCards(selectedDeck.cards).map((card) => card.id),
    });
    setToast("Shuffled for this session. The deck's own order is unchanged.");
  };

  const handleStartReview = (deckId?: string) => {
    const targetDeckId = deckId ?? selectedDeck?.id;
    if (!targetDeckId) return;
    setReviewNow(Date.now());
    setReviewDeckId(targetDeckId);
  };

  const handleExitReview = () => setReviewDeckId(null);

  const handleGrade = (grade: ReviewGrade) => {
    if (!currentCard || !selectedDeck) return;
    // The next card is chosen from the queue as it looks now, before the grade
    // reshuffles it by due date. Pressing Again keeps the card in today's
    // queue, so without this the session would sit on it forever.
    const remaining = visibleCards.filter((card) => card.id !== currentCard.id);
    const nextCard = remaining[cardPosition] ?? remaining[0] ?? null;
    updateSelectedDeckProgress(
      (progress) => ({
        ...progress,
        reviews: {
          ...(progress.reviews ?? {}),
          [currentCard.id]: gradeCard(grade, progress.reviews?.[currentCard.id]),
        },
        currentCardId: nextCard?.id ?? "",
        isFlipped: false,
      }),
      { position: true },
    );
  };

  const handleRestoreOrder = () => {
    setStudyOrder(null);
    setToast("Back to the deck's own order.");
  };

  const handleStudyModeChange = (mode: StudyMode) => {
    setReviewDeckId(null);
    updateSelectedDeckProgress((progress) => ({ ...progress, studyMode: mode }), {
      position: true,
    });
  };

  const resetProgress = () => {
    if (!selectedDeck) return;
    const now = Date.now();
    startTransition(() => {
      // Clearing the lists locally isn't enough: another device still
      // holding the old marks and schedules would merge them straight back.
      // Stamp every live card, including marks this device has not received;
      // resetAt covers the review schedules.
      updateSelectedDeckProgress(
        () => resetDeckProgress(selectedDeck, now),
        { position: true },
      );
    });
    setToast("Progress reset.");
  };

  const toggleKnown = () => {
    if (!currentCard || !activeProgress) return;
    updateSelectedDeckProgress(
      (progress) => {
        const isKnown = progress.knownIds.includes(currentCard.id);
        let nextCurrentCardId = progress.currentCardId;
        if (!isKnown && progress.studyMode === "remaining" && visibleCards.length > 1) {
          const nextIndex = (cardPosition + 1) % visibleCards.length;
          nextCurrentCardId = visibleCards[nextIndex].id;
        }
        return touchKnownCard(
          {
            ...progress,
            currentCardId: nextCurrentCardId,
            isFlipped: false,
            knownIds: isKnown
              ? progress.knownIds.filter((id) => id !== currentCard.id)
              : [...progress.knownIds, currentCard.id],
          },
          currentCard.id,
        );
      },
      { position: true },
    );
  };

  const handleCreateDeck = (sectionId: string) => {
    const title = deckComposer?.title.trim() ?? "";
    const subtitle = deckComposer?.subtitle.trim() ?? "";
    if (!title) {
      setDeckComposerMessage("Give the new deck a name first.");
      return;
    }
    const section = librarySections.find((item) => item.id === sectionId);
    if (!section) {
      setDeckComposerMessage("That section is no longer available.");
      return;
    }
    const parsed = parsePastedFlashcards(deckComposer?.paste ?? "");
    const deckIds = new Set(allDecks.map((deck) => deck.id));
    const deckId = createUniqueId(title, deckIds);
    const now = Date.now();
    const cards = withCardIds(parsed.cards).map((card) => touchCard(card, now));
    const newDeck: Deck = {
      id: deckId,
      title,
      subtitle: subtitle || `Custom flashcards in ${section.title}.`,
      cards,
      updatedAt: now,
    };
    setLibrarySections((currentSections) =>
      currentSections.map((item) =>
        item.id === sectionId ? { ...item, decks: [...item.decks, newDeck] } : item,
      ),
    );
    setDeckProgress((currentProgress) => ({
      ...currentProgress,
      [newDeck.id]: createDeckProgress(newDeck),
    }));
    openDeck(newDeck.id);
    setDeckComposer(null);
    setDeckComposerMessage("");
  };

  const handleAddCards = () => {
    if (!selectedDeck) return;
    const parsed = parsePastedFlashcards(cardPaste);
    if (parsed.cards.length === 0) {
      setCardImportMessage("Paste at least one valid card line first.");
      return;
    }
    const now = Date.now();
    const newCards = withCardIds(
      parsed.cards,
      selectedDeck.cards.map((card) => card.id),
    ).map((card) => touchCard(card, now));
    startTransition(() => {
      setLibrarySections((currentSections) =>
        updateDeckInSections(currentSections, selectedDeck.id, (deck) => ({
          ...deck,
          cards: [...deck.cards, ...newCards],
        })),
      );
      setDeckProgress((currentProgress) => {
        const currentDeckProgress =
          currentProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck);
        return {
          ...currentProgress,
          [selectedDeck.id]: {
            ...currentDeckProgress,
            currentCardId: currentDeckProgress.currentCardId || newCards[0]?.id || "",
          },
        };
      });
    });
    setCardPaste("");
    setCardImportMessage(
      `Added ${newCards.length} card${newCards.length === 1 ? "" : "s"} to ${selectedDeck.title}.`,
    );
  };

  const handleAddSingleCard = () => {
    if (!selectedDeck) return;
    const word = wordInput.trim();
    const def = defInput.trim();
    if (!word || !def) {
      setToast("Add both a word and a definition.");
      return;
    }
    const existingIds = selectedDeck.cards.map((c) => c.id);
    const newCards = withCardIds([{ term: word, definition: def }], existingIds).map((card) =>
      touchCard(card),
    );
    const newCard = newCards[0];
    if (!newCard) return;
    startTransition(() => {
      setLibrarySections((curr) =>
        updateDeckInSections(curr, selectedDeck.id, (deck) => ({
          ...deck,
          cards: [...deck.cards, newCard],
        })),
      );
      setDeckProgress((curr) => {
        const progress = curr[selectedDeck.id] ?? createDeckProgress(selectedDeck);
        return {
          ...curr,
          [selectedDeck.id]: {
            ...progress,
            currentCardId: progress.currentCardId || newCard.id,
          },
        };
      });
    });
    setWordInput("");
    setDefInput("");
    setToast(`Added "${word}".`);
  };

  const openDeck = (deckId: string, cardId?: string) => {
    const viewedAt = Date.now();
    setSelectedDeckId(deckId);
    setView({ kind: "study", deckId });
    // Opening a search hit lands on that card rather than wherever the deck
    // was left. A card already marked known is invisible in "remaining", so
    // that deck switches back to the full deck for this visit.
    if (cardId) {
      setDeckProgress((currentProgress) => {
        const deck = findDeckById(librarySections, deckId);
        if (!deck || !deck.cards.some((card) => card.id === cardId)) return currentProgress;
        const progress = currentProgress[deckId] ?? createDeckProgress(deck);
        const isHidden = progress.studyMode === "remaining" && progress.knownIds.includes(cardId);
        return {
          ...currentProgress,
          [deckId]: touchProgress(
            {
              ...progress,
              currentCardId: cardId,
              isFlipped: false,
              studyMode: isHidden ? "all" : progress.studyMode,
            },
            { position: true },
          ),
        };
      });
    }
    setRecentDeckIds((prev) =>
      [{ id: deckId, viewedAt }, ...prev.filter((e) => e.id !== deckId)].slice(
        0,
        MAX_RECENT_DECKS,
      ),
    );
    setDeckLastViewed((prev) => ({ ...prev, [deckId]: viewedAt }));
  };

  const openDeckForReview = (deckId: string) => {
    openDeck(deckId);
    handleStartReview(deckId);
  };

  const openRandomDeck = (decks: Deck[]) => {
    if (!decks.length) return;
    const deck = decks[Math.floor(Math.random() * decks.length)];
    openDeck(deck.id);
  };

  const togglePinDeck = (deckId: string) => {
    setPinnedDeckIds((current) =>
      current.includes(deckId) ? current.filter((id) => id !== deckId) : [...current, deckId],
    );
    touchPreferences();
  };

  const handleDeleteCard = (cardId: string) => {
    if (!selectedDeck) return;
    const card = selectedDeck.cards.find((c) => c.id === cardId);
    askConfirm(`Delete the card "${card?.term ?? cardId}"? This cannot be undone.`, () => {
      startTransition(() => {
        setLibrarySections((currentSections) =>
          updateDeckInSections(currentSections, selectedDeck.id, (deck) => ({
            ...deck,
            cards: deck.cards.filter((c) => c.id !== cardId),
          })),
        );
        // Recorded so the delete reaches other devices. Without it the next
        // merge would simply take the card back from whichever device still
        // has it.
        setTombstones((current) => recordCardDeletion(current, selectedDeck.id, cardId));
      });
      setToast(`Deleted card.`);
      setConfirmDialog(null);
    });
  };

  const handleUpdateCard = (cardId: string) => {
    if (!selectedDeck) return;
    const edits = cardEdits[cardId];
    if (!edits) return;
    const term = edits.term.trim();
    const definition = edits.definition.trim();
    if (!term || !definition) {
      setToast("Card needs both a term and a definition.");
      return;
    }
    startTransition(() => {
      setLibrarySections((curr) =>
        updateDeckInSections(curr, selectedDeck.id, (deck) => {
          const updated = touchCard({
            ...deck.cards.find((c) => c.id === cardId)!,
            term,
            definition,
          });
          return {
            ...deck,
            cards: [updated, ...deck.cards.filter((c) => c.id !== cardId)],
          };
        }),
      );
    });
    setCardEdits((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
    setToast(`Card updated.`);
  };

  const handleUpdateDeckInfo = ({ title, subtitle }: { title: string; subtitle: string }) => {
    if (!selectedDeck || !title) return;
    startTransition(() => {
      setLibrarySections((curr) =>
        updateDeckInSections(curr, selectedDeck.id, (deck) =>
          touchDeck({ ...deck, title, subtitle }),
        ),
      );
    });
    setToast("Deck updated.");
  };

  const handleExportDeck = async () => {
    if (!selectedDeck) return;
    const lines = selectedDeck.cards.map((card) => `${card.term}\t${card.definition}`);
    const content = lines.join("\n");
    try {
      await navigator.clipboard.writeText(content);
      setToast(
        `Copied ${selectedDeck.cards.length} card${selectedDeck.cards.length === 1 ? "" : "s"} from "${selectedDeck.title}" to clipboard.`,
      );
    } catch {
      setToast("Could not copy to clipboard.");
    }
  };

  const handleDownloadBackup = () => {
    const snapshot = createLibrarySnapshot({
      librarySections,
      deckProgress,
      selectedDeckId,
      tombstones,
      preferences,
    });
    const fileName = buildBackupFileName();
    try {
      downloadTextFile(fileName, serializeBackup(snapshot));
    } catch {
      setBackupMessage("This browser wouldn't let the backup download.");
      return;
    }
    const cardCount = countBackupCards(snapshot);
    setBackupMessage(`Saved ${cardCount} card${cardCount === 1 ? "" : "s"} to ${fileName}.`);
  };

  const handleRestoreBackup = async (file: File) => {
    setBackupMessage(`Reading ${file.name}…`);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setBackupMessage("That file couldn't be read.");
      return;
    }
    const result = readBackup(text);
    if (!result.ok) {
      setBackupMessage(result.message);
      return;
    }

    const { snapshot } = result;
    const cardCount = countBackupCards(snapshot);
    askConfirm(
      `Restore ${cardCount} card${cardCount === 1 ? "" : "s"} from ${file.name}? ` +
        "Anything only in the backup comes back, and nothing already here is removed.",
      () => {
        // Restoring is an explicit request for the backup's contents, so the
        // deletions covering them are dropped first — otherwise the merge
        // would honour them and delete everything again.
        const restoredIds = collectEntityIds(snapshot.librarySections);
        const merged = mergeLibraryState(
          { ...libraryState, tombstones: forgetDeletions(tombstones, restoredIds) },
          {
            librarySections: snapshot.librarySections,
            deckProgress: snapshot.deckProgress,
            tombstones: forgetDeletions(snapshot.tombstones, restoredIds),
            preferences: snapshot.preferences,
          },
        );
        const mergedDeckIds = new Set(flattenDecks(merged.librarySections).map((deck) => deck.id));
        startTransition(() => {
          applyMergedState(
            merged,
            mergedDeckIds.has(selectedDeckId)
              ? selectedDeckId
              : (merged.librarySections[0]?.decks[0]?.id ?? ""),
          );
        });
        setBackupMessage(`Restored ${cardCount} card${cardCount === 1 ? "" : "s"} from ${file.name}.`);
        setConfirmDialog(null);
      },
      { confirmLabel: "Restore", tone: "primary" },
    );
  };

  const handleShareDeck = async () => {
    if (!selectedDeck || !selectedSection || isSharingDeck) return;
    setIsSharingDeck(true);
    setToast("Creating a share link…");
    try {
      const shareId = await createSharedDeck(selectedDeck, selectedSection);
      const shareUrl = buildShareUrl(shareId, window.location.origin);
      try {
        await navigator.clipboard.writeText(shareUrl);
        setToast(`Share link copied — anyone with it can add "${selectedDeck.title}".`);
      } catch {
        // Clipboard permission can be denied. The link is already saved, so
        // show it rather than losing it to a failed copy.
        setToast(`Share link: ${shareUrl}`);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not create a share link.");
    } finally {
      setIsSharingDeck(false);
    }
  };

  const handleImportSharedDeck = () => {
    if (sharedDeckLink?.status !== "ready") return;
    const { sections, deck } = importSharedDeck(librarySections, sharedDeckLink.snapshot);

    // Stamped as new so a tombstone for an id it happens to reuse can't delete
    // it again on the next merge.
    const now = Date.now();
    setLibrarySections(
      sections.map((section) => ({
        ...section,
        decks: section.decks.map((existing) =>
          existing.id === deck.id
            ? touchDeck(
                { ...existing, cards: existing.cards.map((card) => touchCard(card, now)) },
                now,
              )
            : existing,
        ),
      })),
    );
    setDeckProgress((current) => ({ ...current, [deck.id]: createDeckProgress(deck) }));
    setSharedDeckLink(null);
    openDeck(deck.id);
    setToast(`Added "${deck.title}" to your library.`);
  };

  const handleDeleteDeck = (deckId: string) => {
    const deck = flattenDecks(librarySections).find((d) => d.id === deckId);
    const sectionForDeck = findSectionForDeck(librarySections, deckId);
    const currentView = view;
    askConfirm(
      `Delete the deck "${deck?.title ?? deckId}" and all its cards? This cannot be undone.`,
      () => {
        setLibrarySections((currentSections) =>
          currentSections.map((section) => ({
            ...section,
            decks: section.decks.filter((d) => d.id !== deckId),
          })),
        );
        setDeckProgress((currentProgress) => {
          const next = { ...currentProgress };
          delete next[deckId];
          return next;
        });
        setTombstones((current) => recordDeckDeletion(current, deckId));
        setPinnedDeckIds((current) => current.filter((id) => id !== deckId));
        setRecentDeckIds((current) => current.filter((entry) => entry.id !== deckId));
        setDeckLastViewed((current) => {
          const next = { ...current };
          delete next[deckId];
          return next;
        });
        if (currentView.kind === "study" && currentView.deckId === deckId) {
          setView(
            sectionForDeck ? { kind: "section", sectionId: sectionForDeck.id } : { kind: "home" },
          );
        }
        setConfirmDialog(null);
      },
    );
  };

  const handleDeleteSection = (sectionId: string) => {
    const section = librarySections.find((s) => s.id === sectionId);
    askConfirm(
      `Delete the topic "${section?.title ?? sectionId}" and all its decks? This cannot be undone.`,
      () => {
        const deckIds = section?.decks.map((d) => d.id) ?? [];
        setLibrarySections((currentSections) => currentSections.filter((s) => s.id !== sectionId));
        setDeckProgress((currentProgress) => {
          const next = { ...currentProgress };
          deckIds.forEach((id) => delete next[id]);
          return next;
        });
        // The decks are tombstoned individually too: another device may have
        // filed the same deck under a different topic, and a section tombstone
        // alone would leave it there.
        setTombstones((current) => {
          const deletedAt = Date.now();
          return deckIds.reduce(
            (acc, id) => recordDeckDeletion(acc, id, deletedAt),
            recordSectionDeletion(current, sectionId, deletedAt),
          );
        });
        setPinnedDeckIds((current) => current.filter((id) => !deckIds.includes(id)));
        setRecentDeckIds((current) => current.filter((entry) => !deckIds.includes(entry.id)));
        setDeckLastViewed((current) => {
          const next = { ...current };
          deckIds.forEach((id) => delete next[id]);
          return next;
        });
        setView({ kind: "home" });
        setConfirmDialog(null);
      },
    );
  };

  const handleUpdateSection = () => {
    if (!sectionEditor) return;
    const title = sectionEditor.title.trim();
    if (!title) {
      setSectionEditorMessage("Give the topic a name first.");
      return;
    }
    // The id is left alone so decks, progress and pins stay attached.
    const { sectionId, description } = sectionEditor;
    setLibrarySections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? touchSection({ ...section, title, description: description.trim() })
          : section,
      ),
    );
    setSectionEditor(null);
    setSectionEditorMessage("");
    setToast("Topic updated.");
  };

  const handleCreateSection = () => {
    const title = sectionComposer?.title.trim() ?? "";
    if (!title) {
      setSectionComposerMessage("Give the new topic a name first.");
      return;
    }
    const sectionIds = new Set(librarySections.map((s) => s.id));
    const newSection: DeckSection = {
      id: createUniqueId(title, sectionIds),
      title,
      description: sectionComposer?.description.trim() || `Cards from ${title}.`,
      decks: [],
      updatedAt: Date.now(),
    };
    setLibrarySections((current) => [...current, newSection]);
    setSectionComposer(null);
    setSectionComposerMessage("");
  };

  const googleSearch = (type: string) => {
    if (!currentCard) return;
    const query = `${currentCard.term} ${type}`;
    window.open(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setToast(`Opened Google search for "${currentCard.term} ${type}".`);
  };

  const showAiModalFn = () => {
    if (!currentCard) return;
    const word = currentCard.term;
    const prompt = `How do I use the word or phrase "${word}" naturally in a sentence? Give me 3 simple example sentences and explain the best everyday use in simple English.`;
    setAiModal({ word, prompt });
  };

  const openAI = async (provider: "chatgpt" | "claude" | "gemini") => {
    if (!aiModal) return;
    const { word, prompt } = aiModal;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // silent fallback
    }
    const urls = {
      chatgpt: "https://chatgpt.com/",
      claude: "https://claude.ai/",
      gemini: "https://gemini.google.com/",
    };
    window.open(urls[provider], "_blank", "noopener,noreferrer");
    setAiModal(null);
    setToast(`Prompt copied. Paste it into ${provider} to ask about "${word}".`);
  };

  useEffect(() => {
    const nextDecks = flattenDecks(librarySections);
    if (!nextDecks.some((deck) => deck.id === selectedDeckId)) {
      setSelectedDeckId(nextDecks[0]?.id ?? "");
    }
    setDeckProgress((currentProgress) => {
      // Keep existing progress objects (and the map itself) when nothing
      // changed, so downstream persistence and cloud auto-save don't fire
      // for no-op reconciliations.
      let changed = Object.keys(currentProgress).length !== nextDecks.length;
      const nextProgress: Record<string, DeckProgress> = {};
      nextDecks.forEach((deck) => {
        const savedProgress = currentProgress[deck.id];
        if (!savedProgress) {
          changed = true;
          nextProgress[deck.id] = createDeckProgress(deck);
          return;
        }
        const validCardIds = new Set(deck.cards.map((card) => card.id));
        const knownIds = savedProgress.knownIds.filter((id) => validCardIds.has(id));
        const savedReviews = savedProgress.reviews ?? {};
        const reviewEntries = Object.entries(savedReviews).filter(([cardId]) =>
          validCardIds.has(cardId),
        );
        const savedKnownStamps = savedProgress.knownUpdatedAt ?? {};
        const knownStampEntries = Object.entries(savedKnownStamps).filter(([cardId]) =>
          validCardIds.has(cardId),
        );
        const currentCardId = validCardIds.has(savedProgress.currentCardId)
          ? savedProgress.currentCardId
          : (deck.cards[0]?.id ?? "");
        const isFlipped = deck.cards.length ? savedProgress.isFlipped : false;
        if (
          currentCardId === savedProgress.currentCardId &&
          isFlipped === savedProgress.isFlipped &&
          knownIds.length === savedProgress.knownIds.length &&
          reviewEntries.length === Object.keys(savedReviews).length &&
          knownStampEntries.length === Object.keys(savedKnownStamps).length
        ) {
          nextProgress[deck.id] = savedProgress;
          return;
        }
        changed = true;
        nextProgress[deck.id] = {
          ...savedProgress,
          currentCardId,
          isFlipped,
          knownIds,
          reviews: Object.fromEntries(reviewEntries),
          knownUpdatedAt: Object.fromEntries(knownStampEntries),
        };
      });
      return changed ? nextProgress : currentProgress;
    });
  }, [librarySections, selectedDeckId]);

  useEffect(() => {
    if (!selectedDeck || !activeProgress) return;
    if (!selectedDeck.cards.length) {
      if (activeProgress.isFlipped || activeProgress.currentCardId) {
        updateSelectedDeckProgress((progress) => ({
          ...progress,
          currentCardId: "",
          isFlipped: false,
        }));
      }
      return;
    }
    if (!visibleCards.length) {
      if (activeProgress.isFlipped) {
        updateSelectedDeckProgress((progress) => ({ ...progress, isFlipped: false }));
      }
      return;
    }
    if (!visibleCards.some((card) => card.id === activeProgress.currentCardId)) {
      updateSelectedDeckProgress((progress) => ({
        ...progress,
        currentCardId: visibleCards[0].id,
        isFlipped: false,
      }));
    }
  }, [activeProgress, selectedDeck, visibleCards]);

  useDebouncedPersist(LIBRARY_STORAGE_KEY, librarySections);
  useDebouncedPersist(PROGRESS_STORAGE_KEY, deckProgress);
  useDebouncedPersist(SELECTED_DECK_STORAGE_KEY, selectedDeckId);
  useDebouncedPersist(PINNED_DECKS_STORAGE_KEY, pinnedDeckIds);
  useDebouncedPersist(RECENT_DECKS_STORAGE_KEY, recentDeckIds);
  useDebouncedPersist(DECK_LAST_VIEWED_STORAGE_KEY, deckLastViewed);
  useDebouncedPersist(DAILY_CARD_STORAGE_KEY, dailyCardRef);
  useDebouncedPersist(TOMBSTONES_STORAGE_KEY, tombstones);
  useDebouncedPersist(PREFERENCES_UPDATED_AT_STORAGE_KEY, preferencesUpdatedAt);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    safeSetItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.setAttribute("data-accent", accentColor);
    safeSetItem(ACCENT_STORAGE_KEY, accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!showActionsMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showActionsMenu]);

  useEffect(() => {
    setShowCardImporter(false);
    setCardPaste("");
    setCardImportMessage("");
    setIsAutoPlaying(false);
    setShowCardEditor(false);
    setCardEdits({});
    setShowCardList(false);
  }, [selectedDeckId]);

  useEffect(() => {
    if (view.kind !== "study") {
      setIsAutoPlaying(false);
    }
  }, [view.kind]);

  useStudyKeyboard(view.kind === "study", {
    onFlip: handleFlip,
    onNext: () => moveToCard(1),
    onPrev: () => moveToCard(-1),
    onToggleKnown: toggleKnown,
    onShuffle: handleShuffle,
    onGrade: isReviewing ? handleGrade : null,
  });

  useEffect(() => {
    if (!isAutoPlaying || !currentCard || !activeProgress || view.kind !== "study") return;
    const isFlipped = activeProgress.isFlipped;
    const delay = isFlipped ? 3000 : 5000;
    const timer = setTimeout(() => {
      if (isFlipped) moveToCardRef.current(1);
      else handleFlipRef.current();
    }, delay);
    return () => clearTimeout(timer);
    // Only restart when autoplay is toggled, the card changes, or the flip state changes.
    // Omitting other deps intentionally so unrelated re-renders (e.g. cloud sync) don't cancel the timer.
  }, [isAutoPlaying, currentCard?.id, activeProgress?.isFlipped, view.kind]);

  // A `?deck=<id>` link opens that deck instead of the library — the hub's
  // Card of the Day links here, and "open Flashcards" landing on the home
  // screen made you find the deck it had just named.
  //
  // The link is held rather than resolved once on mount: at boot the library
  // is whatever localStorage had, and on a machine that studies from the cloud
  // the deck the link names may be seconds away. Resolving against the local
  // copy would open the wrong deck — findDeckById misses and the app falls
  // back to the first deck there is — so the link waits for its deck to turn
  // up, and says so when it never does.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const link = getDeckLinkFromSearch(window.location.search);
    if (!link) return;

    // Out of the address bar straight away: opening the deck is a one-off, and
    // a reload should land where you left off rather than back on this deck.
    window.history.replaceState(null, "", "/");
    setPendingDeckLink(link);

    const timer = setTimeout(() => {
      setPendingDeckLink((current) => {
        if (current !== link) return current;
        setToast("That deck is not in this library.");
        return null;
      });
    }, DECK_LINK_WAIT_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!pendingDeckLink) return;
    const deck = findDeckById(librarySections, pendingDeckLink.deckId);
    if (!deck) return;

    // A card id from another app is a claim about this library, so it is only
    // honoured once the deck agrees it holds that card. Otherwise the deck
    // opens where it was left, which is the right answer to "open this deck".
    const { cardId } = pendingDeckLink;
    const landOn = cardId && deck.cards.some((card) => card.id === cardId) ? cardId : undefined;
    setPendingDeckLink(null);
    openDeck(deck.id, landOn);
  }, [pendingDeckLink, librarySections]);

  // A `/d/<shareId>` link boots the normal app (the server rewrites unknown
  // paths to index.html), so the import prompt is picked up here on mount
  // rather than through a separate route.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const shareId = getShareIdFromPath(window.location.pathname);
    if (!shareId) return;

    // Drop the share path straight away: the prompt is a one-off, and leaving
    // it in the address bar would re-open it on every reload.
    window.history.replaceState(null, "", "/");

    let cancelled = false;
    setSharedDeckLink({ status: "loading", shareId });
    fetchSharedDeck(shareId)
      .then((snapshot) => {
        if (!cancelled) setSharedDeckLink({ status: "ready", shareId, snapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSharedDeckLink({
          status: "error",
          shareId,
          message: error instanceof Error ? error.message : "That shared deck could not be opened.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const globalOverlays = (
    <>
      <ConfirmOverlay confirmDialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />
      <SharedDeckOverlay
        sharedDeckLink={sharedDeckLink}
        onImport={handleImportSharedDeck}
        onDismiss={() => setSharedDeckLink(null)}
      />
    </>
  );

  // ── HOME VIEW ───────────────────────────────────────────────────────────────

  if (view.kind === "home") {
    return (
      <>
        <HomeView
          librarySections={librarySections}
          deckProgress={deckProgress}
          allDecks={allDecks}
          recentDeckIds={recentDeckIds}
          pinnedDeckIds={pinnedDeckIds}
          showActionsMenu={showActionsMenu}
          setShowActionsMenu={setShowActionsMenu}
          actionsMenuRef={actionsMenuRef}
          setView={setView}
          openDeck={openDeck}
          openRandomDeck={openRandomDeck}
          syncState={cloudSync.syncState}
          syncMessage={cloudSync.syncMessage}
          syncKeyInput={cloudSync.syncKeyInput}
          onSyncKeyInputChange={cloudSync.onSyncKeyInputChange}
          showSyncPanel={showSyncPanel}
          setShowSyncPanel={setShowSyncPanel}
          onApplySyncKey={cloudSync.onApplySyncKey}
          onLoadFromCloud={cloudSync.onLoadFromCloud}
          onSaveToCloud={cloudSync.onSaveToCloud}
          onGenerateSyncKey={cloudSync.onGenerateSyncKey}
          backupMessage={backupMessage}
          onDownloadBackup={handleDownloadBackup}
          onRestoreBackup={handleRestoreBackup}
          showThemesPanel={showThemesPanel}
          setShowThemesPanel={setShowThemesPanel}
          theme={theme}
          setTheme={chooseTheme}
          accentColor={accentColor}
          setAccentColor={chooseAccentColor}
          dailyCard={dailyCard}
          reviewSummary={reviewSummary}
          onStartReview={openDeckForReview}
          sectionComposer={sectionComposer}
          setSectionComposer={setSectionComposer}
          sectionComposerMessage={sectionComposerMessage}
          setSectionComposerMessage={setSectionComposerMessage}
          onCreateSection={handleCreateSection}
        />
        {globalOverlays}
      </>
    );
  }

  // ── PINNED VIEW ─────────────────────────────────────────────────────────────

  if (view.kind === "pinned") {
    return (
      <>
        <PinnedView
          librarySections={librarySections}
          deckProgress={deckProgress}
          pinnedDeckIds={pinnedDeckIds}
          setView={setView}
          openDeck={openDeck}
          openRandomDeck={openRandomDeck}
          togglePinDeck={togglePinDeck}
        />
        {globalOverlays}
      </>
    );
  }

  // ── SECTION VIEW ────────────────────────────────────────────────────────────

  if (view.kind === "section") {
    const section = librarySections.find((s) => s.id === view.sectionId);
    if (!section) {
      setView({ kind: "home" });
      return null;
    }

    return (
      <>
        <SectionView
          section={section}
          deckProgress={deckProgress}
          pinnedDeckIds={pinnedDeckIds}
          deckLastViewed={deckLastViewed}
          deckComposer={deckComposer}
          setDeckComposer={setDeckComposer}
          deckComposerMessage={deckComposerMessage}
          setDeckComposerMessage={setDeckComposerMessage}
          deckImportPreview={deckImportPreview}
          sectionEditor={sectionEditor}
          setSectionEditor={setSectionEditor}
          sectionEditorMessage={sectionEditorMessage}
          setSectionEditorMessage={setSectionEditorMessage}
          setView={setView}
          openDeck={openDeck}
          openRandomDeck={openRandomDeck}
          togglePinDeck={togglePinDeck}
          onCreateDeck={handleCreateDeck}
          onDeleteDeck={handleDeleteDeck}
          onUpdateSection={handleUpdateSection}
          onDeleteSection={handleDeleteSection}
        />
        {globalOverlays}
      </>
    );
  }

  // ── STUDY VIEW ──────────────────────────────────────────────────────────────

  if (!selectedDeck || !selectedSection || !activeProgress) return null;

  return (
    <>
      <StudyView
        selectedDeck={selectedDeck}
        selectedSection={selectedSection}
        activeProgress={activeProgress}
        currentCard={currentCard}
        visibleCards={visibleCards}
        cardPosition={cardPosition}
        pinnedDeckIds={pinnedDeckIds}
        currentCardIsKnown={currentCardIsKnown}
        hasRemainingCards={hasRemainingCards}
        isDeckEmpty={isDeckEmpty}
        isAutoPlaying={isAutoPlaying}
        setIsAutoPlaying={setIsAutoPlaying}
        showCardEditor={showCardEditor}
        setShowCardEditor={setShowCardEditor}
        showCardImporter={showCardImporter}
        setShowCardImporter={setShowCardImporter}
        cardEdits={cardEdits}
        setCardEdits={setCardEdits}
        cardPaste={cardPaste}
        setCardPaste={setCardPaste}
        cardImportMessage={cardImportMessage}
        setCardImportMessage={setCardImportMessage}
        cardImportPreview={cardImportPreview}
        wordInput={wordInput}
        setWordInput={setWordInput}
        defInput={defInput}
        setDefInput={setDefInput}
        toast={toast}
        setShowCardList={setShowCardList}
        setView={setView}
        togglePinDeck={togglePinDeck}
        onStudyModeChange={handleStudyModeChange}
        onFlip={handleFlip}
        isShuffled={isShuffled}
        onShuffle={handleShuffle}
        onRestoreOrder={handleRestoreOrder}
        isReviewing={isReviewing}
        dueCount={deckReviewCounts.due}
        newCount={deckReviewCounts.newCards}
        nextReviewLabel={nextReviewLabel}
        gradePreview={gradePreview}
        onStartReview={() => handleStartReview()}
        onExitReview={handleExitReview}
        onGrade={handleGrade}
        onToggleKnown={toggleKnown}
        onMoveToCard={moveToCard}
        onGoogleSearch={googleSearch}
        onShowAiModal={showAiModalFn}
        onResetProgress={resetProgress}
        onAddCards={handleAddCards}
        onAddSingleCard={handleAddSingleCard}
        onDeleteCard={handleDeleteCard}
        onUpdateCard={handleUpdateCard}
        onUpdateDeckInfo={handleUpdateDeckInfo}
        onExportDeck={handleExportDeck}
        onShareDeck={handleShareDeck}
        isSharingDeck={isSharingDeck}
      />
      <AiOverlay aiModal={aiModal} onClose={() => setAiModal(null)} onOpenAI={openAI} />
      {globalOverlays}
      <CardListOverlay
        show={showCardList}
        selectedDeck={selectedDeck}
        onClose={() => setShowCardList(false)}
      />
    </>
  );
}
