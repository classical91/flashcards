// Types for the server's Card of the Day module, so the parity test in
// src/lib/__tests__/dailyCard.test.ts can hold it against the app's own
// implementation. The runtime code lives in server-daily-card.mjs and is
// deliberately plain JS — server.mjs runs untranspiled.
import type { DeckSection } from "./src/data/deckBuilder";
import type { DeckProgress } from "./src/data/librarySnapshot";

export type DailyCardRef = {
  dateKey: string;
  deckId: string;
  cardId: string;
};

export type ResolvedDailyCard = {
  dateKey: string;
  card: { id: string; term: string; definition: string };
  deck: { id: string; title: string; subtitle: string };
  section: { id: string; title: string };
};

export declare const toDateKey: (date: Date) => string;

export declare const pickDailyCard: (
  sections: DeckSection[],
  deckProgress: Record<string, DeckProgress>,
  dateKey: string,
) => DailyCardRef | null;

export declare const parseDateKey: (value: unknown) => string | null;

export declare const resolveDailyCard: (
  snapshot: unknown,
  dateKey: string,
) => ResolvedDailyCard | null;

export declare const describeDailyCard: (
  snapshot: unknown,
  reference: { deckId: string; cardId: string } | null | undefined,
  dateKey: string,
) => ResolvedDailyCard | null;

export declare const pickFromSnapshot: (snapshot: unknown, dateKey: string) => DailyCardRef | null;

export declare const CANONICAL_WINDOW_DAYS: number;

export declare const isCanonicalDateKey: (dateKey: string, now?: Date) => boolean;

export declare const oldestCanonicalDateKey: (now?: Date) => string;

export type StoredDailyCard = { deckId: string; cardId: string };

export type DailyCardStore = {
  get: (dateKey: string) => Promise<StoredDailyCard | null>;
  claim: (
    dateKey: string,
    expected: StoredDailyCard | null,
    next: StoredDailyCard,
  ) => Promise<StoredDailyCard | null>;
};

export declare const resolveCanonicalDailyCard: (
  snapshot: unknown,
  dateKey: string,
  store: DailyCardStore,
) => Promise<ResolvedDailyCard | null>;
