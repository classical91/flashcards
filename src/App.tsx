import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { defaultDeckId, starterSections } from "./data/decks";
import {
  Deck,
  DeckSection,
  createUniqueId,
  parsePastedFlashcards,
  withCardIds,
} from "./data/deckBuilder";
import {
  LibrarySnapshot,
  createLibrarySnapshot,
  parseLibrarySnapshot,
} from "./data/librarySnapshot";

type StudyMode = "all" | "remaining";

type DeckProgress = {
  currentCardId: string;
  knownIds: string[];
  isFlipped: boolean;
  studyMode: StudyMode;
};

type DeckComposer = {
  sectionId: string;
  title: string;
  subtitle: string;
  paste: string;
};

type SectionComposer = {
  title: string;
  description: string;
};

type ConfirmDialog = {
  message: string;
  onConfirm: () => void;
};

type SyncState = "idle" | "loading" | "saving" | "saved" | "error";

type ViewState =
  | { kind: "home" }
  | { kind: "section"; sectionId: string }
  | { kind: "study"; deckId: string };

type AiModal = {
  word: string;
  prompt: string;
} | null;

const LIBRARY_STORAGE_KEY = "flashcards.library.v2";
const PROGRESS_STORAGE_KEY = "flashcards.progress.v2";
const SELECTED_DECK_STORAGE_KEY = "flashcards.selectedDeck.v2";
const SYNC_KEY_STORAGE_KEY = "flashcards.syncKey.v1";
const DEFAULT_SYNC_KEY =
  import.meta.env.VITE_FLASHCARDS_SYNC_KEY?.trim() || "jasons-flashcards-library";
const syncKeyPattern = /^[A-Za-z0-9_-]{8,120}$/;

const shuffleCards = (cards: { id: string; term: string; definition: string }[]) => {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const cloneSections = (sections: DeckSection[]) =>
  sections.map((section) => ({
    ...section,
    decks: section.decks.map((deck) => ({
      ...deck,
      cards: deck.cards.map((card) => ({ ...card })),
    })),
  }));

const mergeDeck = (cloudDeck: Deck, localDeck: Deck): Deck => {
  const cloudCardIds = new Set(cloudDeck.cards.map((card) => card.id));
  return {
    ...cloudDeck,
    cards: [
      ...cloudDeck.cards.map((card) => ({ ...card })),
      ...localDeck.cards
        .filter((card) => !cloudCardIds.has(card.id))
        .map((card) => ({ ...card })),
    ],
  };
};

const mergeSections = (localSections: DeckSection[], cloudSections: DeckSection[]) => {
  const localSectionsById = new Map(localSections.map((s) => [s.id, s]));
  const cloudSectionIds = new Set(cloudSections.map((s) => s.id));
  const mergedSections = cloudSections.map((cloudSection) => {
    const localSection = localSectionsById.get(cloudSection.id);
    if (!localSection) {
      return {
        ...cloudSection,
        decks: cloudSection.decks.map((deck) => ({
          ...deck,
          cards: deck.cards.map((card) => ({ ...card })),
        })),
      };
    }
    const localDecksById = new Map(localSection.decks.map((deck) => [deck.id, deck]));
    const cloudDeckIds = new Set(cloudSection.decks.map((deck) => deck.id));
    return {
      ...cloudSection,
      decks: [
        ...cloudSection.decks.map((cloudDeck) => {
          const localDeck = localDecksById.get(cloudDeck.id);
          return localDeck ? mergeDeck(cloudDeck, localDeck) : { ...cloudDeck };
        }),
        ...localSection.decks
          .filter((deck) => !cloudDeckIds.has(deck.id))
          .map((deck) => ({ ...deck, cards: deck.cards.map((card) => ({ ...card })) })),
      ],
    };
  });
  return [
    ...mergedSections,
    ...localSections
      .filter((section) => !cloudSectionIds.has(section.id))
      .map((section) => ({
        ...section,
        decks: section.decks.map((deck) => ({
          ...deck,
          cards: deck.cards.map((card) => ({ ...card })),
        })),
      })),
  ];
};

const flattenDecks = (sections: DeckSection[]) => sections.flatMap((s) => s.decks);

const findDeckById = (sections: DeckSection[], deckId: string) =>
  flattenDecks(sections).find((deck) => deck.id === deckId) ?? null;

const findSectionForDeck = (sections: DeckSection[], deckId: string) =>
  sections.find((section) => section.decks.some((deck) => deck.id === deckId)) ??
  sections[0] ??
  null;

const createDeckProgress = (deck: Deck): DeckProgress => ({
  currentCardId: deck.cards[0]?.id ?? "",
  knownIds: [],
  isFlipped: false,
  studyMode: "all",
});

const buildProgressState = (sections: DeckSection[]) =>
  Object.fromEntries(
    flattenDecks(sections).map((deck) => [deck.id, createDeckProgress(deck)]),
  ) as Record<string, DeckProgress>;

const loadLibrarySections = () => {
  if (typeof window === "undefined") return cloneSections(starterSections);
  const saved = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
  if (!saved) return cloneSections(starterSections);
  try {
    const parsed = JSON.parse(saved) as DeckSection[];
    if (!Array.isArray(parsed) || parsed.length === 0) return cloneSections(starterSections);
    return parsed;
  } catch {
    return cloneSections(starterSections);
  }
};

const loadProgressState = (sections: DeckSection[]) => {
  if (typeof window === "undefined") return buildProgressState(sections);
  const saved = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (!saved) return buildProgressState(sections);
  try {
    const parsed = JSON.parse(saved) as Record<string, DeckProgress>;
    if (!parsed || typeof parsed !== "object") return buildProgressState(sections);
    return parsed;
  } catch {
    return buildProgressState(sections);
  }
};

const loadSelectedDeckId = () => {
  if (typeof window === "undefined") return defaultDeckId;
  return window.localStorage.getItem(SELECTED_DECK_STORAGE_KEY) ?? defaultDeckId;
};

const normalizeSyncKey = (value: string) => value.trim();
const isSyncKeyValid = (value: string) => syncKeyPattern.test(value);

const createSyncKey = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  }
  return Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
};

const loadSyncKey = () => {
  if (typeof window === "undefined") return DEFAULT_SYNC_KEY;
  const saved = window.localStorage.getItem(SYNC_KEY_STORAGE_KEY) ?? "";
  return isSyncKeyValid(saved) ? saved : DEFAULT_SYNC_KEY;
};

const getFetchErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.clone().json()) as { message?: string; error?: string };
    return payload.message ?? payload.error ?? `Request failed with ${response.status}.`;
  } catch {
    try {
      const message = (await response.text()).trim();
      if (message) return `${message} (${response.status})`;
    } catch {
      // fall through
    }
    return `Request failed with ${response.status}.`;
  }
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
};

const updateDeckInSections = (
  sections: DeckSection[],
  deckId: string,
  updater: (deck: Deck) => Deck,
) =>
  sections.map((section) => ({
    ...section,
    decks: section.decks.map((deck) => (deck.id === deckId ? updater(deck) : deck)),
  }));

const mergeProgressState = (
  localProgress: Record<string, DeckProgress>,
  cloudProgress: Record<string, DeckProgress>,
  sections: DeckSection[],
) => {
  const mergedProgress: Record<string, DeckProgress> = {};
  flattenDecks(sections).forEach((deck) => {
    const cloudDeckProgress = cloudProgress[deck.id];
    const localDeckProgress = localProgress[deck.id];
    const baseProgress = cloudDeckProgress ?? localDeckProgress ?? createDeckProgress(deck);
    mergedProgress[deck.id] = {
      ...baseProgress,
      knownIds: Array.from(
        new Set([
          ...(cloudDeckProgress?.knownIds ?? []),
          ...(localDeckProgress?.knownIds ?? []),
        ]),
      ),
    };
  });
  return mergedProgress;
};

export default function App() {
  const [librarySections, setLibrarySections] = useState(loadLibrarySections);
  const [deckProgress, setDeckProgress] = useState(() => loadProgressState(librarySections));
  const [selectedDeckId, setSelectedDeckId] = useState(loadSelectedDeckId);
  const [deckComposer, setDeckComposer] = useState<DeckComposer | null>(null);
  const [deckComposerMessage, setDeckComposerMessage] = useState("");
  const [showCardImporter, setShowCardImporter] = useState(false);
  const [cardPaste, setCardPaste] = useState("");
  const [cardImportMessage, setCardImportMessage] = useState("");
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [sectionComposer, setSectionComposer] = useState<SectionComposer | null>(null);
  const [sectionComposerMessage, setSectionComposerMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [syncKey, setSyncKey] = useState(loadSyncKey);
  const [syncKeyInput, setSyncKeyInput] = useState(loadSyncKey);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState(
    "Cloud sync starts automatically for this shared library.",
  );
  const [view, setView] = useState<ViewState>({ kind: "home" });
  const [toast, setToast] = useState(
    "Flashcard = word on the front, definition on the back. Google/AI tools are separate for deeper understanding.",
  );
  const [aiModal, setAiModal] = useState<AiModal>(null);
  const [wordInput, setWordInput] = useState("");
  const [defInput, setDefInput] = useState("");

  const cloudSyncReadyRef = useRef(false);
  const cloudSyncLoadKeyRef = useRef("");
  const snapshotRef = useRef<LibrarySnapshot>(
    createLibrarySnapshot({
      librarySections,
      deckProgress,
      selectedDeckId,
      recentDeckIds: [],
    }),
  );

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
  const isUsingSharedSyncKey = normalizeSyncKey(syncKeyInput) === DEFAULT_SYNC_KEY;

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

  const openRandomDeck = (decks: Deck[]) => {
    if (!decks.length) return;
    const deck = decks[Math.floor(Math.random() * decks.length)];
    setSelectedDeckId(deck.id);
    setView({ kind: "study", deckId: deck.id });
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

  const fetchCloudSnapshot = async (activeSyncKey: string) => {
    const response = await fetch(`/api/libraries/${encodeURIComponent(activeSyncKey)}`);
    if (!response.ok) throw new Error(await getFetchErrorMessage(response));
    return (await response.json()) as { exists?: boolean; snapshot?: unknown; storage?: string };
  };

  const saveSnapshotToCloud = async (activeSyncKey: string, snapshot: LibrarySnapshot) => {
    const response = await fetch(`/api/libraries/${encodeURIComponent(activeSyncKey)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error(await getFetchErrorMessage(response));
  };

  const handleApplySyncKey = () => {
    const nextSyncKey = normalizeSyncKey(syncKeyInput);
    if (!isSyncKeyValid(nextSyncKey)) {
      cloudSyncReadyRef.current = false;
      setSyncState("error");
      setSyncMessage(
        "Sync keys must be 8-120 characters and use only letters, numbers, hyphens, or underscores.",
      );
      return;
    }
    cloudSyncReadyRef.current = false;
    setSyncKey(nextSyncKey);
    setSyncKeyInput(nextSyncKey);
    setSyncState("saved");
    setSyncMessage("Sync key is active. Save to cloud here, then load cloud on your phone or PC.");
  };

  const handleGenerateSyncKey = () => {
    const nextSyncKey = createSyncKey();
    cloudSyncReadyRef.current = false;
    setSyncKey(nextSyncKey);
    setSyncKeyInput(nextSyncKey);
    setSyncState("saved");
    setSyncMessage("New sync key created. Save to cloud to publish this library to your devices.");
  };

  const handleUseSharedLibrary = () => {
    cloudSyncReadyRef.current = false;
    cloudSyncLoadKeyRef.current = "";
    setSyncKey(DEFAULT_SYNC_KEY);
    setSyncKeyInput(DEFAULT_SYNC_KEY);
    setSyncState("loading");
    setSyncMessage("Switching this browser back to the shared cloud library...");
  };

  const handleLoadFromCloud = async () => {
    const activeSyncKey = normalizeSyncKey(syncKeyInput || syncKey);
    if (!isSyncKeyValid(activeSyncKey)) {
      setSyncState("error");
      setSyncMessage("Enter a valid sync key before loading from cloud.");
      return;
    }
    cloudSyncReadyRef.current = false;
    setSyncState("loading");
    setSyncMessage("Loading cloud library...");
    try {
      const payload = await fetchCloudSnapshot(activeSyncKey);
      if (!payload.exists) {
        setSyncKey(activeSyncKey);
        setSyncKeyInput(activeSyncKey);
        setSyncState("error");
        setSyncMessage("No cloud library exists for this key yet. Save it first.");
        return;
      }
      const snapshot = parseLibrarySnapshot(payload.snapshot);
      if (!snapshot) throw new Error("The cloud library was not in the expected format.");
      const mergedSections = mergeSections(librarySections, snapshot.librarySections);
      const mergedProgress = mergeProgressState(deckProgress, snapshot.deckProgress, mergedSections);
      const mergedDeckIds = new Set(flattenDecks(mergedSections).map((deck) => deck.id));
      const nextSelectedDeckId = mergedDeckIds.has(snapshot.selectedDeckId)
        ? snapshot.selectedDeckId
        : selectedDeckId;
      startTransition(() => {
        setLibrarySections(mergedSections);
        setDeckProgress(mergedProgress);
        setSelectedDeckId(nextSelectedDeckId || defaultDeckId);
      });
      setSyncKey(activeSyncKey);
      setSyncKeyInput(activeSyncKey);
      cloudSyncReadyRef.current = true;
      setSyncState("saved");
      setSyncMessage("Merged the cloud library with this device. New changes will auto-save.");
    } catch (error) {
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "Could not load from cloud.");
    }
  };

  const handleSaveThisBrowserToCloud = async () => {
    const activeSyncKey = normalizeSyncKey(syncKeyInput || syncKey);
    if (!isSyncKeyValid(activeSyncKey)) {
      setSyncState("error");
      setSyncMessage("Enter a valid sync key before saving to cloud.");
      return;
    }
    setSyncState("saving");
    setSyncMessage("Saving this device's library to cloud...");
    try {
      await saveSnapshotToCloud(activeSyncKey, snapshotRef.current);
      setSyncKey(activeSyncKey);
      setSyncKeyInput(activeSyncKey);
      cloudSyncReadyRef.current = true;
      setSyncState("saved");
      setSyncMessage("Saved to cloud. Use this key on your phone or PC and load cloud.");
    } catch (error) {
      setSyncState("error");
      setSyncMessage(error instanceof Error ? error.message : "Could not save to cloud.");
    }
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(librarySections));
  }, [librarySections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(deckProgress));
  }, [deckProgress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SELECTED_DECK_STORAGE_KEY, selectedDeckId);
  }, [selectedDeckId]);

  useEffect(() => {
    snapshotRef.current = createLibrarySnapshot({
      librarySections,
      deckProgress,
      selectedDeckId,
      recentDeckIds: [],
    });
  }, [librarySections, deckProgress, selectedDeckId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (syncKey) {
      window.localStorage.setItem(SYNC_KEY_STORAGE_KEY, syncKey);
    } else {
      window.localStorage.removeItem(SYNC_KEY_STORAGE_KEY);
    }
  }, [syncKey]);

  useEffect(() => {
    if (!syncKey || cloudSyncLoadKeyRef.current === syncKey) return;
    cloudSyncLoadKeyRef.current = syncKey;
    cloudSyncReadyRef.current = false;
    setSyncState("loading");
    setSyncMessage("Connecting this device to cloud...");
    fetchCloudSnapshot(syncKey)
      .then((payload) => {
        if (!payload.exists) {
          return saveSnapshotToCloud(syncKey, snapshotRef.current).then(() => {
            cloudSyncReadyRef.current = true;
            setSyncState("saved");
            setSyncMessage("Created a cloud library for this key. Changes will auto-save.");
          });
        }
        const snapshot = parseLibrarySnapshot(payload.snapshot);
        if (!snapshot) throw new Error("The cloud library was not in the expected format.");
        const mergedSections = mergeSections(librarySections, snapshot.librarySections);
        const mergedProgress = mergeProgressState(
          deckProgress,
          snapshot.deckProgress,
          mergedSections,
        );
        const mergedDeckIds = new Set(flattenDecks(mergedSections).map((deck) => deck.id));
        const nextSelectedDeckId = mergedDeckIds.has(selectedDeckId)
          ? selectedDeckId
          : snapshot.selectedDeckId;
        startTransition(() => {
          setLibrarySections(mergedSections);
          setDeckProgress(mergedProgress);
          setSelectedDeckId(nextSelectedDeckId || defaultDeckId);
        });
        cloudSyncReadyRef.current = true;
        setSyncState("saved");
        setSyncMessage("Cloud sync is active on this device. Changes will auto-save.");
      })
      .catch((error) => {
        cloudSyncLoadKeyRef.current = "";
        setSyncState("error");
        setSyncMessage(
          error instanceof Error ? error.message : "Could not connect to cloud sync.",
        );
      });
  }, [syncKey]);

  useEffect(() => {
    if (!syncKey || !cloudSyncReadyRef.current) return;
    setSyncState("saving");
    setSyncMessage("Auto-saving changes to cloud...");
    const timer = window.setTimeout(() => {
      saveSnapshotToCloud(syncKey, snapshotRef.current)
        .then(() => {
          setSyncState("saved");
          setSyncMessage("Cloud sync is up to date.");
        })
        .catch((error) => {
          setSyncState("error");
          setSyncMessage(error instanceof Error ? error.message : "Cloud auto-save failed.");
        });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [librarySections, deckProgress, selectedDeckId, syncKey]);

  useEffect(() => {
    setShowCardImporter(false);
    setCardPaste("");
    setCardImportMessage("");
    setIsAutoPlaying(false);
  }, [selectedDeckId]);

  useEffect(() => {
    if (view.kind !== "study") {
      setIsAutoPlaying(false);
    }
  }, [view.kind]);

  useEffect(() => {
    if (view.kind !== "study") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        handleFlip();
      }
      if (event.key === "ArrowRight") { event.preventDefault(); moveToCard(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); moveToCard(-1); }
      if (event.key.toLowerCase() === "k") { event.preventDefault(); toggleKnown(); }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); handleShuffle(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

  // ── Shared overlays ─────────────────────────────────────────────────────────

  const ConfirmOverlay = confirmDialog ? (
    <div className="confirm-overlay" role="dialog" aria-modal="true">
      <div className="confirm-box">
        <p>{confirmDialog.message}</p>
        <div className="confirm-actions">
          <button className="mini-btn" onClick={() => setConfirmDialog(null)}>Cancel</button>
          <button className="danger-btn" onClick={confirmDialog.onConfirm}>Yes, delete</button>
        </div>
      </div>
    </div>
  ) : null;

  const AiOverlay = aiModal ? (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) setAiModal(null); }}
    >
      <section className="modal">
        <h2>Ask AI about &ldquo;{aiModal.word}&rdquo;?</h2>
        <p>
          This will copy a prompt asking how to use the word naturally in a sentence. Then
          choose which AI app to open.
        </p>
        <div className="prompt-preview">{aiModal.prompt}</div>
        <div className="modal-actions">
          <button className="mini-btn" onClick={() => setAiModal(null)}>Cancel</button>
          <button className="mini-btn" onClick={() => openAI("chatgpt")}>Open ChatGPT</button>
          <button className="mini-btn" onClick={() => openAI("claude")}>Open Claude</button>
          <button className="mini-btn" onClick={() => openAI("gemini")}>Open Gemini</button>
        </div>
      </section>
    </div>
  ) : null;

  // ── HOME VIEW ───────────────────────────────────────────────────────────────

  if (view.kind === "home") {
    return (
      <>
        <div className="home-view">
          <div className="home-header">
            <h1 className="home-title">Flashcards</h1>
            <div className="home-header-actions">
              <button
                className="mini-btn"
                onClick={() => setShowSyncPanel((v) => !v)}
              >
                {syncState === "loading" || syncState === "saving" ? "Syncing…" : "☁ Sync"}
              </button>
              <button
                className="mini-btn"
                onClick={() => openRandomDeck(allDecks)}
                disabled={allDecks.length === 0}
                title="Open a random deck from any topic"
              >
                Shuffle all
              </button>
              <button
                className="mini-btn"
                onClick={() => {
                  setSectionComposerMessage("");
                  setSectionComposer({ title: "", description: "" });
                }}
              >
                + New topic
              </button>
            </div>
          </div>

          {showSyncPanel && (
            <div className="panel-card home-panel">
              <div className="panel-card-head">
                <strong>Cloud sync</strong>
                <button className="link-btn" onClick={() => setShowSyncPanel(false)}>Close</button>
              </div>
              <div className="field">
                <label>Sync key</label>
                <input
                  type="text"
                  value={syncKeyInput}
                  onChange={(e) => {
                    cloudSyncReadyRef.current = false;
                    setSyncKeyInput(e.target.value);
                  }}
                  placeholder="Shared cloud library key"
                />
              </div>
              {!isUsingSharedSyncKey && (
                <p className="hint-text">Using a custom sync key.</p>
              )}
              <div className="panel-card-actions">
                <button className="mini-btn" onClick={handleApplySyncKey}>Use key</button>
                <button
                  className="mini-btn"
                  onClick={handleLoadFromCloud}
                  disabled={syncState === "loading" || syncState === "saving"}
                >
                  Load cloud
                </button>
                <button
                  className="mini-btn"
                  onClick={handleSaveThisBrowserToCloud}
                  disabled={syncState === "loading" || syncState === "saving"}
                >
                  Save to cloud
                </button>
                <button
                  className="mini-btn"
                  onClick={handleUseSharedLibrary}
                  disabled={isUsingSharedSyncKey || syncState === "loading" || syncState === "saving"}
                >
                  Shared library
                </button>
                <button className="mini-btn" onClick={handleGenerateSyncKey}>New key</button>
              </div>
              <p
                className={`message-line${syncState === "error" ? " error" : syncState === "saved" ? " success" : ""}`}
              >
                {syncMessage}
              </p>
            </div>
          )}

          {sectionComposer && (
            <div className="panel-card home-panel">
              <div className="panel-card-head">
                <strong>New topic</strong>
                <button
                  className="link-btn"
                  onClick={() => { setSectionComposer(null); setSectionComposerMessage(""); }}
                >
                  Close
                </button>
              </div>
              <div className="field">
                <label>Topic name</label>
                <input
                  type="text"
                  value={sectionComposer.title}
                  onChange={(e) =>
                    setSectionComposer((c) => (c ? { ...c, title: e.target.value } : c))
                  }
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
              {sectionComposerMessage && (
                <p className="message-line error">{sectionComposerMessage}</p>
              )}
              <div className="panel-card-actions">
                <button className="mini-btn" onClick={handleCreateSection}>Create topic</button>
              </div>
            </div>
          )}

          <div className="home-main">
            {librarySections.length === 0 ? (
              <div className="empty-state">
                No topics yet. Create one above to get started.
              </div>
            ) : (
              <div className="sections-grid">
                {librarySections.map((section) => {
                  const cardCount = section.decks.reduce((sum, d) => sum + d.cards.length, 0);
                  const sectionKnown = section.decks.reduce((sum, d) => {
                    return sum + (deckProgress[d.id]?.knownIds.length ?? 0);
                  }, 0);
                  return (
                    <button
                      key={section.id}
                      className="section-card"
                      onClick={() => setView({ kind: "section", sectionId: section.id })}
                    >
                      <div className="section-card-inner">
                        <div>
                          <div className="section-card-title">{section.title}</div>
                          <div className="section-card-meta">
                            {section.decks.length} deck{section.decks.length !== 1 ? "s" : ""}{" "}
                            · {cardCount} card{cardCount !== 1 ? "s" : ""}
                            {sectionKnown > 0 ? ` · ${sectionKnown} known` : ""}
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
            )}
          </div>
        </div>
        {ConfirmOverlay}
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
        <div className="app">
          <header className="topbar">
            <button className="topbar-btn" onClick={() => setView({ kind: "home" })}>
              ‹ Home
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
                onClick={() => handleDeleteSection(section.id)}
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
                  <button className="mini-btn" onClick={() => handleCreateDeck(section.id)}>
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
                        onClick={() => {
                          setSelectedDeckId(deck.id);
                          setView({ kind: "study", deckId: deck.id });
                        }}
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
                        className="deck-card-delete"
                        title="Delete deck"
                        onClick={() => handleDeleteDeck(deck.id)}
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
        {ConfirmOverlay}
      </>
    );
  }

  // ── STUDY VIEW ──────────────────────────────────────────────────────────────

  if (!selectedDeck || !selectedSection || !activeProgress) return null;

  return (
    <>
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
            <div className="study-mode-toggle">
              <button
                className={`study-mode-btn${activeProgress.studyMode === "all" ? " active" : ""}`}
                onClick={() => handleStudyModeChange("all")}
              >
                All
              </button>
              <button
                className={`study-mode-btn${activeProgress.studyMode === "remaining" ? " active" : ""}`}
                onClick={() => handleStudyModeChange("remaining")}
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
                <section className="card-shell-new" aria-live="polite">
                  <article
                    className={`card-3d${activeProgress.isFlipped ? " flipped" : ""}`}
                    onClick={handleFlip}
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
                  <button className="icon-btn" onClick={handleShuffle} title="Shuffle deck">
                    ↭
                  </button>
                  <button
                    className="icon-btn"
                    onClick={toggleKnown}
                    title={currentCardIsKnown ? "Unmark known" : "Mark as known"}
                    style={{ color: currentCardIsKnown ? "#2a7d4f" : undefined }}
                  >
                    {currentCardIsKnown ? "✓" : "×"}
                  </button>
                  <button className="circle-btn" onClick={() => moveToCard(-1)} title="Previous">
                    ‹
                  </button>
                  <div className="counter">
                    {cardPosition + 1} / {visibleCards.length}
                  </div>
                  <button className="circle-btn" onClick={() => moveToCard(1)} title="Next">
                    ›
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => setIsAutoPlaying((v) => !v)}
                    title="Autoplay"
                  >
                    {isAutoPlaying ? "❚❚" : "▶"}
                  </button>
                  <button className="icon-btn" onClick={handleFlip} title="Flip card">
                    ⟳
                  </button>
                </nav>

                <section className="deep-tools">
                  <div className="deep-title">Deeper understanding tools</div>
                  <div className="lookup-bar">
                    <button className="lookup-chip" onClick={() => googleSearch("definition")}>
                      Google definition
                    </button>
                    <button className="lookup-chip" onClick={() => googleSearch("synonyms")}>
                      Google synonyms
                    </button>
                    <button className="lookup-chip" onClick={() => googleSearch("antonyms")}>
                      Google antonyms
                    </button>
                    <button className="lookup-chip" onClick={() => googleSearch("etymology")}>
                      Google etymology
                    </button>
                    <button className="lookup-chip ai" onClick={showAiModalFn}>
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
                  <button className="mini-btn" onClick={() => handleStudyModeChange("all")}>
                    Review full deck
                  </button>
                  <button className="mini-btn" onClick={resetProgress}>
                    Reset progress
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="bottom-panel" aria-label="Deck tools">
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
                <button className="mini-btn" onClick={handleAddCards}>
                  Add pasted cards
                </button>
              </div>
            </div>
          )}

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
              onKeyDown={(e) => { if (e.key === "Enter") handleAddSingleCard(); }}
            />
            <button className="mini-btn" onClick={handleAddSingleCard}>Add</button>
          </div>
          <button
            className="mini-btn"
            onClick={() => { setShowCardImporter((v) => !v); setCardImportMessage(""); }}
          >
            {showCardImporter ? "Hide import" : "Bulk import"}
          </button>
          <button className="mini-btn" onClick={resetProgress}>Reset</button>
          {currentCard && (
            <button
              className="mini-btn danger"
              onClick={() => handleDeleteCard(currentCard.id)}
            >
              Delete card
            </button>
          )}
          <div className="toast">{toast}</div>
        </section>
      </div>

      {AiOverlay}
      {ConfirmOverlay}
    </>
  );
}
