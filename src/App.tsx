import { startTransition, useEffect, useRef, useState } from "react";
import { defaultDeckId, starterSections } from "./data/decks";
import {
  Deck,
  DeckSection,
  Flashcard,
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

const LIBRARY_STORAGE_KEY = "flashcards.library.v2";
const PROGRESS_STORAGE_KEY = "flashcards.progress.v2";
const SELECTED_DECK_STORAGE_KEY = "flashcards.selectedDeck.v2";
const SYNC_KEY_STORAGE_KEY = "flashcards.syncKey.v1";
const DEFAULT_SYNC_KEY =
  import.meta.env.VITE_FLASHCARDS_SYNC_KEY?.trim() || "jasons-flashcards-library";
const syncKeyPattern = /^[A-Za-z0-9_-]{8,120}$/;

const shuffleCards = (cards: Flashcard[]) => {
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

const mergeSections = (
  localSections: DeckSection[],
  cloudSections: DeckSection[],
) => {
  const localSectionsById = new Map(localSections.map((section) => [section.id, section]));
  const cloudSectionIds = new Set(cloudSections.map((section) => section.id));
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
          .map((deck) => ({
            ...deck,
            cards: deck.cards.map((card) => ({ ...card })),
          })),
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

const flattenDecks = (sections: DeckSection[]) =>
  sections.flatMap((section) => section.decks);

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
  if (typeof window === "undefined") {
    return cloneSections(starterSections);
  }

  const saved = window.localStorage.getItem(LIBRARY_STORAGE_KEY);

  if (!saved) {
    return cloneSections(starterSections);
  }

  try {
    const parsed = JSON.parse(saved) as DeckSection[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return cloneSections(starterSections);
    }

    return parsed;
  } catch {
    return cloneSections(starterSections);
  }
};

const loadProgressState = (sections: DeckSection[]) => {
  if (typeof window === "undefined") {
    return buildProgressState(sections);
  }

  const saved = window.localStorage.getItem(PROGRESS_STORAGE_KEY);

  if (!saved) {
    return buildProgressState(sections);
  }

  try {
    const parsed = JSON.parse(saved) as Record<string, DeckProgress>;

    if (!parsed || typeof parsed !== "object") {
      return buildProgressState(sections);
    }

    return parsed;
  } catch {
    return buildProgressState(sections);
  }
};

const loadSelectedDeckId = () => {
  if (typeof window === "undefined") {
    return defaultDeckId;
  }

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
  if (typeof window === "undefined") {
    return DEFAULT_SYNC_KEY;
  }

  const saved = window.localStorage.getItem(SYNC_KEY_STORAGE_KEY) ?? "";
  return isSyncKeyValid(saved) ? saved : DEFAULT_SYNC_KEY;
};

const getFetchErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as { message?: string; error?: string };
    return payload.message ?? payload.error ?? `Request failed with ${response.status}.`;
  } catch {
    return `Request failed with ${response.status}.`;
  }
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

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
    const baseProgress =
      cloudDeckProgress ?? localDeckProgress ?? createDeckProgress(deck);

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
  const [deckProgress, setDeckProgress] = useState(() =>
    loadProgressState(loadLibrarySections()),
  );
  const [selectedDeckId, setSelectedDeckId] = useState(loadSelectedDeckId);
  const [deckComposer, setDeckComposer] = useState<DeckComposer | null>(null);
  const [deckComposerMessage, setDeckComposerMessage] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const saved = loadSelectedDeckId();
    const section = librarySections.find((s) => s.decks.some((d) => d.id === saved));
    return new Set(section ? [section.id] : []);
  });
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
  const studyPanelRef = useRef<HTMLElement>(null);
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

  const allDecks = flattenDecks(librarySections);
  const selectedDeck = findDeckById(librarySections, selectedDeckId) ?? allDecks[0] ?? null;
  const selectedSection = selectedDeck
    ? findSectionForDeck(librarySections, selectedDeck.id)
    : librarySections[0] ?? null;

  const activeProgress = selectedDeck
    ? deckProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck)
    : null;

  const knownSet = new Set(activeProgress?.knownIds ?? []);
  const visibleCards =
    selectedDeck && activeProgress?.studyMode === "remaining"
      ? selectedDeck.cards.filter((card) => !knownSet.has(card.id))
      : selectedDeck?.cards ?? [];

  const currentCard =
    visibleCards.find((card) => card.id === activeProgress?.currentCardId) ??
    visibleCards[0] ??
    null;

  const cardPosition = currentCard
    ? visibleCards.findIndex((card) => card.id === currentCard.id)
    : -1;

  const totalCards = selectedDeck?.cards.length ?? 0;
  const knownCount = activeProgress?.knownIds.length ?? 0;
  const completionRatio = totalCards ? knownCount / totalCards : 0;
  const remainingCount = totalCards - knownCount;
  const hasRemainingCards = remainingCount > 0;
  const currentCardIsKnown = currentCard ? knownSet.has(currentCard.id) : false;
  const isDeckEmpty = totalCards === 0;

  const deckImportPreview = deckComposer?.paste
    ? parsePastedFlashcards(deckComposer.paste)
    : { cards: [], invalidLines: [] };
  const cardImportPreview = cardPaste
    ? parsePastedFlashcards(cardPaste)
    : { cards: [], invalidLines: [] };

  const updateSelectedDeckProgress = (
    updater: (progress: DeckProgress) => DeckProgress,
  ) => {
    if (!selectedDeck) {
      return;
    }

    setDeckProgress((currentProgress) => {
      const nextProgress = updater(
        currentProgress[selectedDeck.id] ?? createDeckProgress(selectedDeck),
      );

      return {
        ...currentProgress,
        [selectedDeck.id]: nextProgress,
      };
    });
  };

  const handleFlip = () => {
    updateSelectedDeckProgress((progress) => ({
      ...progress,
      isFlipped: !progress.isFlipped,
    }));
  };

  const moveToCard = (direction: 1 | -1) => {
    if (!currentCard || !selectedDeck || !activeProgress || !visibleCards.length) {
      return;
    }

    const nextIndex =
      (cardPosition + direction + visibleCards.length) % visibleCards.length;

    updateSelectedDeckProgress((progress) => ({
      ...progress,
      currentCardId: visibleCards[nextIndex].id,
      isFlipped: false,
    }));
  };

  const handleShuffle = () => {
    if (!selectedDeck) {
      return;
    }

    startTransition(() => {
      setLibrarySections((currentSections) =>
        updateDeckInSections(currentSections, selectedDeck.id, (deck) => ({
          ...deck,
          cards: shuffleCards(deck.cards),
        })),
      );
    });
  };

  const handleStudyModeChange = (mode: StudyMode) => {
    updateSelectedDeckProgress((progress) => ({
      ...progress,
      studyMode: mode,
    }));
  };

  const resetProgress = () => {
    if (!selectedDeck) {
      return;
    }

    startTransition(() => {
      updateSelectedDeckProgress(() => createDeckProgress(selectedDeck));
    });
  };

  const toggleKnown = () => {
    if (!currentCard || !activeProgress) {
      return;
    }

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
        item.id === sectionId
          ? {
              ...item,
              decks: [...item.decks, newDeck],
            }
          : item,
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
    if (!selectedDeck) {
      return;
    }

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
            currentCardId:
              currentDeckProgress.currentCardId || newCards[0]?.id || "",
          },
        };
      });
    });

    setCardPaste("");
    setCardImportMessage(
      `Added ${newCards.length} card${newCards.length === 1 ? "" : "s"} to ${selectedDeck.title}.`,
    );
  };

  const handleDeleteCard = (cardId: string) => {
    if (!selectedDeck) return;
    const card = selectedDeck.cards.find((c) => c.id === cardId);
    askConfirm(
      `Delete the card "${card?.term ?? cardId}"? This cannot be undone.`,
      () => {
        startTransition(() => {
          setLibrarySections((currentSections) =>
            updateDeckInSections(currentSections, selectedDeck.id, (deck) => ({
              ...deck,
              cards: deck.cards.filter((c) => c.id !== cardId),
            })),
          );
        });
        setConfirmDialog(null);
      },
    );
  };

  const handleDeleteDeck = (deckId: string) => {
    const deck = flattenDecks(librarySections).find((d) => d.id === deckId);
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
    setExpandedSections((prev) => new Set([...prev, newSection.id]));
    setSectionComposer(null);
    setSectionComposerMessage("");
  };

  const fetchCloudSnapshot = async (activeSyncKey: string) => {
    const response = await fetch(`/api/libraries/${encodeURIComponent(activeSyncKey)}`);

    if (!response.ok) {
      throw new Error(await getFetchErrorMessage(response));
    }

    return (await response.json()) as {
      exists?: boolean;
      snapshot?: unknown;
      storage?: string;
    };
  };

  const saveSnapshotToCloud = async (
    activeSyncKey: string,
    snapshot: LibrarySnapshot,
  ) => {
    const response = await fetch(`/api/libraries/${encodeURIComponent(activeSyncKey)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      throw new Error(await getFetchErrorMessage(response));
    }
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

  const handleLoadFromCloud = async () => {
    const activeSyncKey = normalizeSyncKey(syncKeyInput || syncKey);

    if (!isSyncKeyValid(activeSyncKey)) {
      setSyncState("error");
      setSyncMessage("Enter a valid sync key before loading from cloud.");
      return;
    }

    cloudSyncReadyRef.current = false;
    setSyncState("loading");
    setSyncMessage("Loading cloud library from Railway...");

    try {
      const payload = await fetchCloudSnapshot(activeSyncKey);

      if (!payload.exists) {
        setSyncKey(activeSyncKey);
        setSyncKeyInput(activeSyncKey);
        setSyncState("error");
        setSyncMessage("No cloud library exists for this key yet. Save it from Chrome first.");
        return;
      }

      const snapshot = parseLibrarySnapshot(payload.snapshot);

      if (!snapshot) {
        throw new Error("The cloud library was not in the expected format.");
      }

      const mergedSections = mergeSections(librarySections, snapshot.librarySections);
      const mergedProgress = mergeProgressState(
        deckProgress,
        snapshot.deckProgress,
        mergedSections,
      );
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
    if (!selectedDeck || !activeProgress) {
      return;
    }

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
        updateSelectedDeckProgress((progress) => ({
          ...progress,
          isFlipped: false,
        }));
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
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify(librarySections),
    );
  }, [librarySections]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify(deckProgress),
    );
  }, [deckProgress]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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
    if (typeof window === "undefined") {
      return;
    }

    if (syncKey) {
      window.localStorage.setItem(SYNC_KEY_STORAGE_KEY, syncKey);
    } else {
      window.localStorage.removeItem(SYNC_KEY_STORAGE_KEY);
    }
  }, [syncKey]);

  useEffect(() => {
    if (!syncKey || cloudSyncLoadKeyRef.current === syncKey) {
      return;
    }

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

        if (!snapshot) {
          throw new Error("The cloud library was not in the expected format.");
        }

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
    if (!syncKey || !cloudSyncReadyRef.current) {
      return;
    }

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
          setSyncMessage(
            error instanceof Error ? error.message : "Cloud auto-save failed.",
          );
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        handleFlip();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveToCard(1);
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveToCard(-1);
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleKnown();
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleShuffle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    if (!isAutoPlaying || !currentCard || !activeProgress) return;

    const delay = activeProgress.isFlipped ? 3000 : 5000;
    const timer = setTimeout(() => {
      if (activeProgress.isFlipped) {
        moveToCard(1);
      } else {
        handleFlip();
      }
    }, delay);

    return () => clearTimeout(timer);
  });

  if (!selectedDeck || !selectedSection || !activeProgress) {
    return null;
  }

  return (
    <main className="app-shell">
      <section className="intro-panel">
        <p className="eyebrow">Flashcard library</p>
        <h1>Build decks by source.</h1>
        <p className="deck-copy">
          Add new decks under GPT, Wikipedia, or Oxford Dictionaries, then paste
          cards in the way Quizlet exports them.
        </p>

        <div className="composer-panel sync-panel">
          <div className="composer-head">
            <strong>Cloud sync</strong>
            <button
              type="button"
              className="plain-link"
              onClick={() => setShowSyncPanel((current) => !current)}
              aria-expanded={showSyncPanel}
            >
              {showSyncPanel ? "Hide" : "Show"}
            </button>
          </div>

          {showSyncPanel ? (
            <>
              <label className="field">
                <span>Sync key</span>
                <input
                  type="text"
                  value={syncKeyInput}
                  onChange={(event) => {
                    cloudSyncReadyRef.current = false;
                    setSyncKeyInput(event.target.value);
                  }}
                  placeholder="Shared cloud library key"
                />
              </label>

              <p className="hint">
                This app auto-loads and auto-saves the shared cloud library. Use
                a different key only when you want a separate private library.
              </p>

              <div className="composer-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleApplySyncKey}
                >
                  Use key
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleLoadFromCloud}
                  disabled={syncState === "loading" || syncState === "saving"}
                >
                  Load cloud
                </button>
                <button
                  type="button"
                  className="accent-button"
                  onClick={handleSaveThisBrowserToCloud}
                  disabled={syncState === "loading" || syncState === "saving"}
                >
                  Save to cloud
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={handleGenerateSyncKey}
                >
                  New key
                </button>
              </div>
            </>
          ) : null}

          <p
            className={
              syncState === "error"
                ? "message-line error"
                : syncState === "saved"
                  ? "message-line success"
                  : "message-line"
            }
          >
            {syncMessage}
          </p>
        </div>

        <div className="library-stack-header">
          <button
            type="button"
            className="toggle-all-button"
            onClick={() =>
              setExpandedSections((prev) =>
                prev.size === librarySections.length
                  ? new Set()
                  : new Set(librarySections.map((s) => s.id)),
              )
            }
          >
            {expandedSections.size === librarySections.length ? "Collapse all" : "Expand all"}
          </button>
          <button
            type="button"
            className="inline-button"
            onClick={() => {
              setSectionComposerMessage("");
              setSectionComposer({ title: "", description: "" });
            }}
          >
            New topic
          </button>
        </div>

        {sectionComposer && (
          <div className="composer-panel">
            <div className="composer-head">
              <strong>New topic</strong>
              <button
                type="button"
                className="plain-link"
                onClick={() => {
                  setSectionComposer(null);
                  setSectionComposerMessage("");
                }}
              >
                Close
              </button>
            </div>
            <label className="field">
              <span>Topic name</span>
              <input
                type="text"
                value={sectionComposer.title}
                onChange={(e) =>
                  setSectionComposer((cur) => cur ? { ...cur, title: e.target.value } : cur)
                }
                placeholder="e.g. Greek Mythology"
              />
            </label>
            <label className="field">
              <span>Description (optional)</span>
              <input
                type="text"
                value={sectionComposer.description}
                onChange={(e) =>
                  setSectionComposer((cur) => cur ? { ...cur, description: e.target.value } : cur)
                }
                placeholder="Short note about this topic"
              />
            </label>
            {sectionComposerMessage && (
              <p className="message-line error">{sectionComposerMessage}</p>
            )}
            <div className="composer-actions">
              <button
                type="button"
                className="primary-button"
                onClick={handleCreateSection}
              >
                Create topic
              </button>
            </div>
          </div>
        )}

        <div className="library-stack">
          {librarySections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            const toggleSection = () =>
              setExpandedSections((prev) => {
                const next = new Set(prev);
                if (next.has(section.id)) {
                  next.delete(section.id);
                } else {
                  next.add(section.id);
                }
                return next;
              });

            return (
            <div key={section.id} className="section-block">
              <div className="section-head">
                <button
                  type="button"
                  className="section-toggle"
                  onClick={toggleSection}
                  aria-expanded={isExpanded}
                >
                  <span className={`section-chevron${isExpanded ? " open" : ""}`}>›</span>
                  <span className="section-title">{section.title}</span>
                </button>
                {isExpanded && (
                  <div className="section-head-actions">
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => {
                        setDeckComposerMessage("");
                        setDeckComposer({
                          sectionId: section.id,
                          title: "",
                          subtitle: "",
                          paste: "",
                        });
                      }}
                    >
                      New deck
                    </button>
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => handleDeleteSection(section.id)}
                    >
                      Delete topic
                    </button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="deck-list">
                  {section.decks.length ? (
                    section.decks.map((deck) => {
                      const deckState =
                        deckProgress[deck.id] ?? createDeckProgress(deck);
                      const isSelected = deck.id === selectedDeck.id;

                      return (
                        <div key={deck.id} className="deck-row">
                          <button
                            type="button"
                            className={isSelected ? "deck-button active" : "deck-button"}
                            onClick={() => {
                              setSelectedDeckId(deck.id);
                              studyPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                          >
                            <span className="deck-button-name">{deck.title}</span>
                            <span className="deck-button-meta">
                              {deck.cards.length} cards / {deckState.knownIds.length} known
                            </span>
                          </button>
                          <button
                            type="button"
                            className="deck-delete-btn"
                            title="Delete deck"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteDeck(deck.id);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="empty-library-note">
                      No decks here yet. Use New deck to add one.
                    </div>
                  )}
                </div>
              )}

              {deckComposer?.sectionId === section.id ? (
                <div className="composer-panel">
                  <div className="composer-head">
                    <strong>New deck in {section.title}</strong>
                    <button
                      type="button"
                      className="plain-link"
                      onClick={() => {
                        setDeckComposer(null);
                        setDeckComposerMessage("");
                      }}
                    >
                      Close
                    </button>
                  </div>

                  <label className="field">
                    <span>Deck name</span>
                    <input
                      type="text"
                      value={deckComposer.title}
                      onChange={(event) =>
                        setDeckComposer((current) =>
                          current
                            ? {
                                ...current,
                                title: event.target.value,
                              }
                            : current,
                        )
                      }
                      placeholder="Example: Common compliments"
                    />
                  </label>

                  <label className="field">
                    <span>Subtitle</span>
                    <input
                      type="text"
                      value={deckComposer.subtitle}
                      onChange={(event) =>
                        setDeckComposer((current) =>
                          current
                            ? {
                                ...current,
                                subtitle: event.target.value,
                              }
                            : current,
                        )
                      }
                      placeholder="Optional note about the deck"
                    />
                  </label>

                  <label className="field">
                    <span>Paste cards</span>
                    <textarea
                      value={deckComposer.paste}
                      onChange={(event) =>
                        setDeckComposer((current) =>
                          current
                            ? {
                                ...current,
                                paste: event.target.value,
                              }
                            : current,
                        )
                      }
                      placeholder={"adaptable\table to adjust easily\nadmirable\tdeserving respect"}
                    />
                  </label>

                  <p className="hint">
                    Best results: paste Quizlet-style rows with a tab between
                    term and definition. Auto-import also accepts `term -
                    definition`, `term: definition`, and simple `term-definition`
                    lines.
                  </p>

                  <div className="import-stats">
                    <span>{deckImportPreview.cards.length} cards ready</span>
                    <span>{deckImportPreview.invalidLines.length} skipped lines</span>
                  </div>

                  {deckComposerMessage ? (
                    <p className="message-line error">{deckComposerMessage}</p>
                  ) : null}

                  <div className="composer-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => handleCreateDeck(section.id)}
                    >
                      Create deck
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
          })}
        </div>

        <div className="selected-block">
          <div className="selected-head">
            <span className="source-chip">{selectedSection.title}</span>
            <span>{totalCards} cards</span>
          </div>
          <h2>{selectedDeck.title}</h2>
          <p>{selectedDeck.subtitle}</p>
        </div>

        <div className="meter-block">
          <div className="meter-head">
            <span>{knownCount} mastered</span>
            <span>{remainingCount} left</span>
          </div>
          <div className="meter-track" aria-hidden="true">
            <div
              className="meter-fill"
              style={{ width: `${completionRatio * 100}%` }}
            />
          </div>
        </div>

        <div className="stat-row" aria-label="Deck statistics">
          <div>
            <strong>{totalCards}</strong>
            <span>Total cards</span>
          </div>
          <div>
            <strong>{visibleCards.length}</strong>
            <span>In view</span>
          </div>
          <div>
            <strong>{knownCount}</strong>
            <span>Known</span>
          </div>
        </div>

        <div className="mode-switch" aria-label="Study mode">
          <button
            type="button"
            className={
              activeProgress.studyMode === "all" ? "mode-button active" : "mode-button"
            }
            onClick={() => handleStudyModeChange("all")}
            aria-pressed={activeProgress.studyMode === "all"}
          >
            Study all
          </button>
          <button
            type="button"
            className={
              activeProgress.studyMode === "remaining"
                ? "mode-button active"
                : "mode-button"
            }
            onClick={() => handleStudyModeChange("remaining")}
            disabled={!hasRemainingCards}
            aria-pressed={activeProgress.studyMode === "remaining"}
          >
            Only remaining
          </button>
        </div>

        <div className="shortcut-list">
          <p>Keyboard shortcuts</p>
          <span>Space or Enter to flip</span>
          <span>Left and Right arrows to move</span>
          <span>K to mark known, S to shuffle</span>
        </div>
      </section>

      <section className="study-panel" ref={studyPanelRef}>
        <div className="study-head">
          <div>
            <p className="eyebrow">{selectedSection.title}</p>
            <h2>{selectedDeck.title}</h2>
            <p className="study-subtitle">
              {isDeckEmpty
                ? "This deck is empty until you paste some cards."
                : !currentCard
                  ? "You've finished the remaining cards in this study view."
                : `Card ${Math.max(cardPosition + 1, 1)} of ${Math.max(
                    visibleCards.length,
                    1,
                  )}`}
            </p>
          </div>
          <div className="card-status">
            <span>
              {activeProgress.studyMode === "all" ? "Whole deck" : "Remaining only"}
            </span>
            {currentCardIsKnown ? (
              <strong className="known-pill">Known</strong>
            ) : (
              <strong className="fresh-pill">
                {isDeckEmpty ? "Needs cards" : "In rotation"}
              </strong>
            )}
          </div>
        </div>

        <div className="builder-bar">
          <button
            type="button"
            className={showCardImporter ? "accent-button active" : "accent-button"}
            onClick={() => {
              setShowCardImporter((current) => !current);
              setCardImportMessage("");
            }}
          >
            {showCardImporter ? "Hide add cards" : "Add cards"}
          </button>
          <p>Paste Quizlet rows or one card per line to extend this deck.</p>
        </div>

        {showCardImporter || isDeckEmpty ? (
          <div className="composer-panel wide">
            <div className="composer-head">
              <strong>Add cards to {selectedDeck.title}</strong>
              {!isDeckEmpty ? (
                <button
                  type="button"
                  className="plain-link"
                  onClick={() => {
                    setShowCardImporter(false);
                    setCardImportMessage("");
                  }}
                >
                  Close
                </button>
              ) : null}
            </div>

            <label className="field">
              <span>Paste cards</span>
              <textarea
                value={cardPaste}
                onChange={(event) => setCardPaste(event.target.value)}
                placeholder={"adaptable\table to adjust easily\nadmirable\tdeserving respect"}
              />
            </label>

            <p className="hint">
              Works best with Quizlet-style pasted rows. You can also use `term -
              definition`, `term: definition`, or `term-definition`.
            </p>

            <div className="import-stats">
              <span>{cardImportPreview.cards.length} cards ready</span>
              <span>{cardImportPreview.invalidLines.length} skipped lines</span>
            </div>

            {cardImportMessage ? (
              <p
                className={
                  cardImportMessage.startsWith("Added")
                    ? "message-line success"
                    : "message-line error"
                }
              >
                {cardImportMessage}
              </p>
            ) : null}

            <div className="composer-actions">
              <button type="button" className="primary-button" onClick={handleAddCards}>
                Add pasted cards
              </button>
            </div>
          </div>
        ) : null}

        {isDeckEmpty ? (
          <div className="empty-deck-panel">
            <p className="eyebrow">Ready for imports</p>
            <h3>Paste your flashcards to start this deck.</h3>
            <p>
              Once cards are added, this space becomes the normal study view with
              flip, shuffle, and progress tracking.
            </p>
          </div>
        ) : currentCard ? (
          <>
            <div
              className="card-shell"
              onClick={handleFlip}
              role="button"
              tabIndex={0}
              aria-label={`Flip card for ${currentCard.term}`}
            >
              <div
                className={activeProgress.isFlipped ? "flashcard is-flipped" : "flashcard"}
              >
                <article className="card-face card-front">
                  <div className="card-labels">
                    <span>Word</span>
                    <span>Tap to reveal meaning</span>
                  </div>
                  <div className="card-body">
                    <p className="term">{currentCard.term}</p>
                  </div>
                  <p className="card-foot">
                    {selectedDeck.title} / {selectedSection.title}
                  </p>
                </article>

                <article className="card-face card-back">
                  <div className="card-labels">
                    <span>Meaning</span>
                    <span>Tap to see the word again</span>
                  </div>
                  <div className="card-body">
                    <p className="definition">{currentCard.definition}</p>
                  </div>
                  <p className="card-foot">Use the controls below to keep moving</p>
                </article>
              </div>
            </div>

            <div className="control-row">
              <button type="button" className="ghost-button" onClick={() => moveToCard(-1)}>
                Previous
              </button>
              <button type="button" className="primary-button" onClick={handleFlip}>
                {activeProgress.isFlipped ? "Show word" : "Flip card"}
              </button>
              <button type="button" className="ghost-button" onClick={() => moveToCard(1)}>
                Next
              </button>
            </div>

            <div className="utility-row">
              <button
                type="button"
                className={currentCardIsKnown ? "accent-button active" : "accent-button"}
                onClick={toggleKnown}
                aria-pressed={currentCardIsKnown}
              >
                {currentCardIsKnown ? "Marked known" : "Mark as known"}
              </button>
              <button
                type="button"
                className={isAutoPlaying ? "accent-button active" : "accent-button"}
                onClick={() => setIsAutoPlaying((v) => !v)}
                aria-pressed={isAutoPlaying}
              >
                {isAutoPlaying ? "⏸ Pause" : "▶ Autoplay"}
              </button>
              <button type="button" className="text-button" onClick={handleShuffle}>
                Shuffle deck
              </button>
              <button type="button" className="text-button" onClick={resetProgress}>
                Reset progress
              </button>
              {currentCard && (
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => handleDeleteCard(currentCard.id)}
                >
                  Delete card
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="completion-panel">
            <p className="eyebrow">{selectedDeck.title}</p>
            <h2>You've worked through every remaining card.</h2>
            <p>
              Switch back to the full deck for review or reset your progress to
              study this set again from the beginning.
            </p>
            <div className="control-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => handleStudyModeChange("all")}
              >
                Review full deck
              </button>
              <button type="button" className="ghost-button" onClick={resetProgress}>
                Reset progress
              </button>
            </div>
          </div>
        )}
      </section>
      {confirmDialog && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-box">
            <p>{confirmDialog.message}</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="danger-button"
                onClick={confirmDialog.onConfirm}
              >
                Yes, delete
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
