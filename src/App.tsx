import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  Deck,
  DeckSection,
  createUniqueId,
  parsePastedFlashcards,
  withCardIds,
} from "./data/deckBuilder";
import {
  ACCENT_STORAGE_KEY,
  LIBRARY_STORAGE_KEY,
  MAX_RECENT_DECKS,
  PINNED_DECKS_STORAGE_KEY,
  PROGRESS_STORAGE_KEY,
  RECENT_DECKS_STORAGE_KEY,
  SELECTED_DECK_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./lib/constants";
import {
  createDeckProgress,
  findDeckById,
  findSectionForDeck,
  flattenDecks,
  shuffleCards,
  updateDeckInSections,
} from "./lib/deckUtils";
import {
  loadAccentColor,
  loadLibrarySections,
  loadPinnedDeckIds,
  loadProgressState,
  loadRecentDeckIds,
  loadSelectedDeckId,
  loadTheme,
  safeSetItem,
} from "./lib/storage";
import {
  AccentColor,
  AiModal,
  ConfirmDialog,
  DeckComposer,
  DeckProgress,
  RecentDeckEntry,
  SectionComposer,
  StudyMode,
  Theme,
  ViewState,
} from "./lib/types";
import { useCloudSync } from "./hooks/useCloudSync";
import { useDebouncedPersist } from "./hooks/useDebouncedPersist";
import { useStudyKeyboard } from "./hooks/useStudyKeyboard";
import { AiOverlay, CardListOverlay, ConfirmOverlay } from "./components/Overlays";
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
  const [cardEdits, setCardEdits] = useState<Record<string, { term: string; definition: string }>>({});
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [sectionComposer, setSectionComposer] = useState<SectionComposer | null>(null);
  const [sectionComposerMessage, setSectionComposerMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
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
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [accentColor, setAccentColor] = useState<AccentColor>(loadAccentColor);

  const actionsMenuRef = useRef<HTMLDivElement>(null);

  const cloudSync = useCloudSync({
    librarySections,
    deckProgress,
    selectedDeckId,
    setLibrarySections,
    setDeckProgress,
    setSelectedDeckId,
  });

  const askConfirm = (message: string, onConfirm: () => void) => {
    setConfirmDialog({ message, onConfirm });
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
        : librarySections[0] ?? null,
    [selectedDeck, librarySections],
  );

  const activeProgress = useMemo(
    () =>
      selectedDeck
        ? deckProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck)
        : null,
    [selectedDeck, deckProgress],
  );

  const knownSet = useMemo(() => new Set(activeProgress?.knownIds ?? []), [activeProgress]);

  const visibleCards = useMemo(() => {
    if (!selectedDeck) return [];
    return activeProgress?.studyMode === "remaining"
      ? selectedDeck.cards.filter((card) => !knownSet.has(card.id))
      : selectedDeck.cards;
  }, [selectedDeck, activeProgress?.studyMode, knownSet]);

  const currentCard = useMemo(
    () =>
      visibleCards.find((card) => card.id === activeProgress?.currentCardId) ??
      visibleCards[0] ??
      null,
    [visibleCards, activeProgress?.currentCardId],
  );

  const cardPosition = useMemo(
    () =>
      currentCard ? visibleCards.findIndex((card) => card.id === currentCard.id) : -1,
    [currentCard, visibleCards],
  );

  const totalCards = selectedDeck?.cards.length ?? 0;
  const knownCount = activeProgress?.knownIds.length ?? 0;
  const remainingCount = totalCards - knownCount;
  const hasRemainingCards = remainingCount > 0;
  const currentCardIsKnown = currentCard ? knownSet.has(currentCard.id) : false;
  const isDeckEmpty = totalCards === 0;

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

  const updateSelectedDeckProgress = (updater: (progress: DeckProgress) => DeckProgress) => {
    if (!selectedDeck) return;
    setDeckProgress((currentProgress) => {
      const nextProgress = updater(
        currentProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck),
      );
      return { ...currentProgress, [selectedDeck.id]: nextProgress };
    });
  };

  const handleFlip = () => {
    updateSelectedDeckProgress((progress) => ({ ...progress, isFlipped: !progress.isFlipped }));
  };

  const moveToCard = (direction: 1 | -1) => {
    if (!currentCard || !selectedDeck || !activeProgress || !visibleCards.length) return;
    const nextIndex = (cardPosition + direction + visibleCards.length) % visibleCards.length;
    updateSelectedDeckProgress((progress) => ({
      ...progress,
      currentCardId: visibleCards[nextIndex].id,
      isFlipped: false,
    }));
  };

  const handleFlipRef = useRef(handleFlip);
  handleFlipRef.current = handleFlip;
  const moveToCardRef = useRef(moveToCard);
  moveToCardRef.current = moveToCard;

  const handleShuffle = () => {
    if (!selectedDeck) return;
    startTransition(() => {
      setLibrarySections((currentSections) =>
        updateDeckInSections(currentSections, selectedDeck.id, (deck) => ({
          ...deck,
          cards: shuffleCards(deck.cards),
        })),
      );
    });
    setToast("Deck shuffled.");
  };

  const handleStudyModeChange = (mode: StudyMode) => {
    updateSelectedDeckProgress((progress) => ({ ...progress, studyMode: mode }));
  };

  const resetProgress = () => {
    if (!selectedDeck) return;
    startTransition(() => {
      updateSelectedDeckProgress(() => createDeckProgress(selectedDeck));
    });
    setToast("Progress reset.");
  };

  const toggleKnown = () => {
    if (!currentCard || !activeProgress) return;
    updateSelectedDeckProgress((progress) => {
      const isKnown = progress.knownIds.includes(currentCard.id);
      let nextCurrentCardId = progress.currentCardId;
      if (!isKnown && progress.studyMode === "remaining" && visibleCards.length > 1) {
        const nextIndex = (cardPosition + 1) % visibleCards.length;
        nextCurrentCardId = visibleCards[nextIndex].id;
      }
      return {
        ...progress,
        currentCardId: nextCurrentCardId,
        isFlipped: false,
        knownIds: isKnown
          ? progress.knownIds.filter((id) => id !== currentCard.id)
          : [...progress.knownIds, currentCard.id],
      };
    });
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
    const cards = withCardIds(parsed.cards);
    const newDeck: Deck = {
      id: deckId,
      title,
      subtitle: subtitle || `Custom flashcards in ${section.title}.`,
      cards,
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
    setSelectedDeckId(newDeck.id);
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
    const newCards = withCardIds(parsed.cards, selectedDeck.cards.map((card) => card.id));
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
    const newCards = withCardIds([{ term: word, definition: def }], existingIds);
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

  const openDeck = (deckId: string) => {
    setSelectedDeckId(deckId);
    setView({ kind: "study", deckId });
    setRecentDeckIds((prev) => [{ id: deckId, viewedAt: Date.now() }, ...prev.filter((e) => e.id !== deckId)].slice(0, MAX_RECENT_DECKS));
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
          const updated = { ...deck.cards.find((c) => c.id === cardId)!, term, definition };
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
        updateDeckInSections(curr, selectedDeck.id, (deck) => ({ ...deck, title, subtitle })),
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
      setToast(`Copied ${selectedDeck.cards.length} card${selectedDeck.cards.length === 1 ? "" : "s"} from "${selectedDeck.title}" to clipboard.`);
    } catch {
      setToast("Could not copy to clipboard.");
    }
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
        setPinnedDeckIds((current) => current.filter((id) => id !== deckId));
        if (currentView.kind === "study" && currentView.deckId === deckId) {
          setView(
            sectionForDeck
              ? { kind: "section", sectionId: sectionForDeck.id }
              : { kind: "home" },
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
        setLibrarySections((currentSections) =>
          currentSections.filter((s) => s.id !== sectionId),
        );
        setDeckProgress((currentProgress) => {
          const next = { ...currentProgress };
          deckIds.forEach((id) => delete next[id]);
          return next;
        });
        setPinnedDeckIds((current) => current.filter((id) => !deckIds.includes(id)));
        setView({ kind: "home" });
        setConfirmDialog(null);
      },
    );
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
      const nextProgress: Record<string, DeckProgress> = {};
      nextDecks.forEach((deck) => {
        const savedProgress = currentProgress[deck.id] ?? createDeckProgress(deck);
        const validCardIds = new Set(deck.cards.map((card) => card.id));
        const knownIds = savedProgress.knownIds.filter((id) => validCardIds.has(id));
        const currentCardId = validCardIds.has(savedProgress.currentCardId)
          ? savedProgress.currentCardId
          : deck.cards[0]?.id ?? "";
        nextProgress[deck.id] = {
          ...savedProgress,
          currentCardId,
          isFlipped: deck.cards.length ? savedProgress.isFlipped : false,
          knownIds,
        };
      });
      return nextProgress;
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

  const serializedLibrary = useMemo(
    () => JSON.stringify(librarySections),
    [librarySections],
  );
  const serializedProgress = useMemo(() => JSON.stringify(deckProgress), [deckProgress]);
  const serializedPinned = useMemo(() => JSON.stringify(pinnedDeckIds), [pinnedDeckIds]);
  const serializedRecent = useMemo(() => JSON.stringify(recentDeckIds), [recentDeckIds]);

  useDebouncedPersist(LIBRARY_STORAGE_KEY, serializedLibrary);
  useDebouncedPersist(PROGRESS_STORAGE_KEY, serializedProgress);
  useDebouncedPersist(SELECTED_DECK_STORAGE_KEY, selectedDeckId);
  useDebouncedPersist(PINNED_DECKS_STORAGE_KEY, serializedPinned);
  useDebouncedPersist(RECENT_DECKS_STORAGE_KEY, serializedRecent);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoPlaying, currentCard?.id, activeProgress?.isFlipped, view.kind]);

  const confirmOverlay = (
    <ConfirmOverlay confirmDialog={confirmDialog} onCancel={() => setConfirmDialog(null)} />
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
          isUsingSharedSyncKey={cloudSync.isUsingSharedSyncKey}
          showSyncPanel={showSyncPanel}
          setShowSyncPanel={setShowSyncPanel}
          onApplySyncKey={cloudSync.onApplySyncKey}
          onLoadFromCloud={cloudSync.onLoadFromCloud}
          onSaveToCloud={cloudSync.onSaveToCloud}
          onUseSharedLibrary={cloudSync.onUseSharedLibrary}
          onGenerateSyncKey={cloudSync.onGenerateSyncKey}
          showThemesPanel={showThemesPanel}
          setShowThemesPanel={setShowThemesPanel}
          theme={theme}
          setTheme={setTheme}
          accentColor={accentColor}
          setAccentColor={setAccentColor}
          sectionComposer={sectionComposer}
          setSectionComposer={setSectionComposer}
          sectionComposerMessage={sectionComposerMessage}
          setSectionComposerMessage={setSectionComposerMessage}
          onCreateSection={handleCreateSection}
        />
        {confirmOverlay}
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
        {confirmOverlay}
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
          deckComposer={deckComposer}
          setDeckComposer={setDeckComposer}
          deckComposerMessage={deckComposerMessage}
          setDeckComposerMessage={setDeckComposerMessage}
          deckImportPreview={deckImportPreview}
          setView={setView}
          openDeck={openDeck}
          openRandomDeck={openRandomDeck}
          togglePinDeck={togglePinDeck}
          onCreateDeck={handleCreateDeck}
          onDeleteDeck={handleDeleteDeck}
          onDeleteSection={handleDeleteSection}
        />
        {confirmOverlay}
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
        onShuffle={handleShuffle}
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
      />
      <AiOverlay aiModal={aiModal} onClose={() => setAiModal(null)} onOpenAI={openAI} />
      {confirmOverlay}
      <CardListOverlay
        show={showCardList}
        selectedDeck={selectedDeck}
        onClose={() => setShowCardList(false)}
      />
    </>
  );
}
