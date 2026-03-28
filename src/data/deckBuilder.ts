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
  subtitle: string;
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

  const separatorIndex = entry.indexOf("-");

  if (separatorIndex === -1) {
    return {
      term: entry,
      definition: fallbackDefinitions[entry] ?? "definition coming soon",
    };
  }

  return {
    term: entry.slice(0, separatorIndex),
    definition: entry.slice(separatorIndex + 1),
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

  const colonIndex = line.indexOf(":");

  if (colonIndex >= 0) {
    return [line.slice(0, colonIndex), line.slice(colonIndex + 1)];
  }

  const hyphenIndex = line.indexOf("-");

  if (hyphenIndex >= 0) {
    return [line.slice(0, hyphenIndex), line.slice(hyphenIndex + 1)];
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
    subtitle,
    cards: withCardIds(cards),
  };
};
