import { useEffect, useMemo, useRef, useState } from "react";
import { DeckSection } from "../data/deckBuilder";
import { DeckProgress } from "../data/librarySnapshot";
import {
  DailyCardRef,
  dailyCardExists,
  isConfirmedFor,
  pickDailyCard,
  reconcileDailyCard,
} from "../lib/dailyCard";
import { findDeckById, findSectionForDeck } from "../lib/deckUtils";
import { loadDailyCard } from "../lib/storage";
import { fetchCanonicalDailyCard } from "../lib/sync";

type UseDailyCardOptions = {
  librarySections: DeckSection[];
  deckProgress: Record<string, DeckProgress>;
  todayKey: string;
  /** The sync key of the cloud library this device is connected to, if any. */
  connectedSyncKey: string | null;
  /** Bumps whenever a load or save reaches the cloud. */
  syncGeneration: number;
  /** True while this device is still connecting to its cloud library. */
  isConnecting: boolean;
};

/**
 * The Card of the Day.
 *
 * With a cloud library connected, the card is the cloud's: the server stores
 * the first pick made for each library and date and hands the same one to
 * every device and to Main Hub's Daily Dashboard for the rest of that day.
 * This hook asks for it once the library has synced and holds on to it.
 *
 * Without one — no cloud library, offline, or the cloud not yet answered —
 * the device picks for itself with the same rule and keeps that pick for the
 * day. The cloud's answer replaces it the moment one arrives; see
 * reconcileDailyCard for why the cloud always wins.
 *
 * Either way the pick is made once and then left alone: marking it known,
 * grading other cards, or any other progress change never rerolls it.
 */
export function useDailyCard({
  librarySections,
  deckProgress,
  todayKey,
  connectedSyncKey,
  syncGeneration,
  isConnecting,
}: UseDailyCardOptions) {
  const [dailyCardRef, setDailyCardRef] = useState<DailyCardRef | null>(loadDailyCard);
  const [isFetching, setIsFetching] = useState(false);
  // Which library and day the cloud has answered for in this session. A pick
  // confirmed yesterday, or by the library this device synced with before
  // switching keys, still shows straight away but is checked once more.
  const [answeredFor, setAnsweredFor] = useState("");
  const attemptRef = useRef("");

  // The answer to a request lands after it was made, so it is reconciled
  // against the library as it is then, not as it was when the request left.
  const librarySectionsRef = useRef(librarySections);
  librarySectionsRef.current = librarySections;
  // An answer for another library or another day is no answer at all.
  const askingFor = connectedSyncKey ? `${connectedSyncKey}|${todayKey}` : "";
  const askingForRef = useRef(askingFor);
  askingForRef.current = askingFor;

  // The pick is stored by id, so resolve it against the live library — that
  // way a deck deleted mid-day just retires the pick instead of dangling, and a
  // renamed deck shows its new name.
  const resolved = useMemo(() => {
    if (!dailyCardRef || dailyCardRef.dateKey !== todayKey) return null;
    const deck = findDeckById(librarySections, dailyCardRef.deckId);
    const card = deck?.cards.find((c) => c.id === dailyCardRef.cardId);
    if (!deck || !card) return null;
    return { deck, card, section: findSectionForDeck(librarySections, deck.id) };
  }, [dailyCardRef, todayKey, librarySections]);

  const isSettled =
    !!resolved && isConfirmedFor(dailyCardRef, todayKey) && answeredFor === askingFor;

  // Picks locally only when there is nothing to show: the effect exits as soon
  // as the stored pick resolves, so marking it known won't reroll it.
  useEffect(() => {
    if (resolved) return;
    const next = pickDailyCard(librarySections, deckProgress, todayKey);
    if (next) setDailyCardRef(next);
  }, [resolved, librarySections, deckProgress, todayKey]);

  // Asks the cloud whenever this device holds anything short of a confirmed
  // pick that still resolves: on connecting, at midnight, and after a sync
  // once the confirmed card was deleted here. At most one request per sync,
  // so a cloud that cannot answer is not asked again until something changes.
  useEffect(() => {
    if (!connectedSyncKey || isSettled) return;
    const attempt = `${askingFor}|${syncGeneration}`;
    if (attemptRef.current === attempt) return;
    attemptRef.current = attempt;

    setIsFetching(true);
    fetchCanonicalDailyCard(connectedSyncKey, todayKey)
      .then((canonical) => {
        if (askingForRef.current !== askingFor) return;
        const sections = librarySectionsRef.current;
        setDailyCardRef((local) => reconcileDailyCard(local, canonical, sections));
        if (canonical && dailyCardExists(sections, canonical)) setAnsweredFor(askingFor);
      })
      .catch(() => {
        // Offline or the server is down: the local pick stands.
      })
      .finally(() => {
        // Only the latest request decides whether one is still on its way.
        if (attemptRef.current === attempt) setIsFetching(false);
      });
  }, [connectedSyncKey, todayKey, askingFor, syncGeneration, isSettled]);

  // A pick the cloud has not confirmed may be about to change, so while the
  // answer is on its way nothing is shown rather than a card that is swapped
  // out a moment later. Offline, connecting fails and the local pick shows.
  const isAwaitingCloud = !isConfirmedFor(dailyCardRef, todayKey) && (isConnecting || isFetching);

  return { dailyCard: isAwaitingCloud ? null : resolved, dailyCardRef };
}
