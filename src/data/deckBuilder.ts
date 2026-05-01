export type Flashcard = {
  id: string;
  term: string;
  definition: string;
};

export type Deck = {
  id: string;
  title: string;
  subtitle: string;
  cards: Flashcard[];
};

export type DeckSection = {
  id: string;
  title: string;
  description: string;
  decks: Deck[];
};

type CreateDeckOptions = {
  id: string;
  title: string;
  subtitle?: string;
  raw: string;
  protectedTerms?: string[];
  fallbackDefinitions?: Record<string, string>;
};

type ParsedFlashcardInput = {
  term: string;
  definition: string;
};

type ParsedFlashcardResult = {
  cards: ParsedFlashcardInput[];
  invalidLines: string[];
};

const definitionStarterWords = new Set([
  "a",
  "an",
  "the",
  "to",
  "with",
  "without",
  "from",
  "about",
  "feeling",
  "feelings",
  "emotion",
  "emotions",
  "emotional",
  "state",
  "condition",
  "quality",
  "ability",
  "capacity",
  "process",
  "act",
  "idea",
  "theory",
  "framework",
  "pattern",
  "form",
  "episode",
  "episodes",
  "sense",
  "study",
  "response",
  "distress",
  "discomfort",
  "comfort",
  "care",
  "confidence",
  "curiosity",
  "attention",
  "expectation",
  "avoidance",
  "lack",
  "deep",
  "gentle",
  "intense",
  "mild",
  "strong",
  "sudden",
  "quiet",
  "warm",
  "overwhelming",
  "personal",
  "lingering",
  "sentimental",
  "genuine",
  "awareness",
  "anger",
  "joy",
  "sorrow",
  "longing",
  "remorse",
]);

export const createSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const createUniqueId = (value: string, existingIds: Set<string>) => {
  const baseId = createSlug(value) || "deck";

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;

  while (existingIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
};

const normalizeDefinition = (definition: string) =>
  definition.replace(/,/g, ", ").replace(/\s+/g, " ").trim();

const countWords = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

const getLeadingWord = (value: string) =>
  value.trim().match(/^[("'\[]*([A-Za-z]+)/)?.[1]?.toLowerCase() ?? "";

const chooseHyphenSplit = (line: string) => {
  const candidates: Array<{ left: string; right: string; score: number }> = [];

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "-") {
      continue;
    }

    const left = line.slice(0, index).trim();
    const right = line.slice(index + 1).trim();

    if (!left || !right) {
      continue;
    }

    const rightLeadWord = getLeadingWord(right);
    const leftWords = countWords(left);
    const rightWords = countWords(right);
    let score = 0;

    if (definitionStarterWords.has(rightLeadWord)) {
      score += 5;
    }

    if (/^[a-z]/.test(rightLeadWord)) {
      score += 1;
    }

    if (rightWords >= 3) {
      score += 2;
    }

    if (right.length > left.length) {
      score += 2;
    }

    if (right.length > left.length * 1.5) {
      score += 1;
    }

    if (leftWords >= 1 && leftWords <= 8) {
      score += 1;
    }

    if (/^[A-Z0-9]/.test(left) || /[()]/.test(left)) {
      score += 1;
    }

    if (leftWords > 12) {
      score -= 2;
    }

    if (rightWords < 2) {
      score -= 2;
    }

    score += index / Math.max(line.length, 1) / 100;

    candidates.push({ left, right, score });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((first, second) => second.score - first.score);
  return candidates[0];
};

const normalizeEntry = (
  entry: string,
  protectedTerms: string[],
  fallbackDefinitions: Record<string, string>,
) => {
  for (const protectedTerm of protectedTerms) {
    const protectedPrefix = `${protectedTerm}-`;

    if (entry.startsWith(protectedPrefix)) {
      return {
        term: protectedTerm,
        definition: entry.slice(protectedPrefix.length),
      };
    }
  }

  const hyphenSplit = chooseHyphenSplit(entry);

  if (!hyphenSplit) {
    return {
      term: entry,
      definition: fallbackDefinitions[entry] ?? "definition coming soon",
    };
  }

  return {
    term: hyphenSplit.left,
    definition: hyphenSplit.right,
  };
};

export const withCardIds = (
  entries: ParsedFlashcardInput[],
  existingIds: Iterable<string> = [],
) => {
  const usedIds = new Set(existingIds);

  return entries.map(({ term, definition }) => {
    const id = createUniqueId(term, usedIds);

    usedIds.add(id);

    return {
      id,
      term: term.trim(),
      definition: normalizeDefinition(definition),
    };
  });
};

const splitLine = (line: string) => {
  const tabIndex = line.indexOf("\t");

  if (tabIndex >= 0) {
    return [line.slice(0, tabIndex), line.slice(tabIndex + 1)];
  }

  const spacedMatch = line.match(/\s[-–—]\s/);

  if (spacedMatch?.index !== undefined) {
    const separator = spacedMatch[0];
    const separatorIndex = spacedMatch.index;

    return [
      line.slice(0, separatorIndex),
      line.slice(separatorIndex + separator.length),
    ];
  }

  // Handle unspaced en/em dashes: e.g. "Faith–Trust in God" or "Grace—God's favor"
  const unspacedDashMatch = line.match(/[\u2013\u2014]/);

  if (unspacedDashMatch?.index !== undefined) {
    return [
      line.slice(0, unspacedDashMatch.index),
      line.slice(unspacedDashMatch.index + 1),
    ];
  }

  const colonIndex = line.indexOf(":");

  if (colonIndex >= 0) {
    return [line.slice(0, colonIndex), line.slice(colonIndex + 1)];
  }

  const hyphenSplit = chooseHyphenSplit(line);

  if (hyphenSplit) {
    return [hyphenSplit.left, hyphenSplit.right];
  }

  return null;
};

export const parsePastedFlashcards = (raw: string): ParsedFlashcardResult => {
  const cards: ParsedFlashcardInput[] = [];
  const invalidLines: string[] = [];

  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const split = splitLine(line);

      if (!split) {
        invalidLines.push(line);
        return;
      }

      const [term, definition] = split.map((part) => part.trim());

      if (!term || !definition) {
        invalidLines.push(line);
        return;
      }

      cards.push({
        term,
        definition,
      });
    });

  return {
    cards,
    invalidLines,
  };
};

export const createDeckFromRaw = ({
  id,
  title,
  subtitle,
  raw,
  protectedTerms = [],
  fallbackDefinitions = {},
}: CreateDeckOptions): Deck => {
  const cards = raw
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => normalizeEntry(entry, protectedTerms, fallbackDefinitions));

  return {
    id,
    title,
    subtitle: subtitle ?? "",
    cards: withCardIds(cards),
  };
};
