// Types for the server's recently viewed cards module. The runtime code lives
// in server-recent-cards.mjs and is plain JS — server.mjs runs untranspiled.

export type RecentCard = {
  viewedAt: string | null;
  card: { id: string; term: string; definition: string };
  deck: { id: string; title: string; subtitle: string };
  section: { id: string; title: string };
};

export declare const DEFAULT_RECENT_LIMIT: number;
export declare const MAX_RECENT_LIMIT: number;
export declare const parseRecentLimit: (value: unknown) => number;
export declare const resolveRecentCards: (snapshot: unknown, limit?: number) => RecentCard[];
