// Export a deck's word list to an AI chat so it can bring the definitions up
// to date, then paste the answer back in through Bulk import.

export type AiProvider = "chatgpt" | "claude" | "grok";

export const AI_PROVIDERS: { id: AiProvider; label: string }[] = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "grok", label: "Grok" },
];

// Each site opens a new chat with the `q` text already in the message box.
const PREFILL_URLS: Record<AiProvider, string> = {
  chatgpt: "https://chatgpt.com/?q=",
  claude: "https://claude.ai/new?q=",
  grok: "https://grok.com/?q=",
};

const HOME_URLS: Record<AiProvider, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  grok: "https://grok.com/",
};

// Long links get refused by the sites (or their CDNs), so a big deck opens a
// blank chat and relies on the prompt already being on the clipboard.
export const MAX_PREFILL_URL_LENGTH = 7000;

export function buildDefinitionRefreshPrompt(
  deckTitle: string,
  cards: { term: string; definition: string }[],
): string {
  // " - " is one of the separators Bulk import reads, and unlike a tab it
  // survives being copied out of a chat reply.
  const list = cards
    .map((card) => `${oneLine(card.term)} - ${oneLine(card.definition)}`)
    .join("\n");
  return [
    `Here is my flashcard list "${oneLine(deckTitle)}". Each line is a word, then " - ", then its definition.`,
    "",
    "Please optimize the definitions where required: make sure each one is accurate, clear and up to date, and make each one unique so no two cards read alike. If a definition is already good, leave it as it is. Keep every word exactly as written, keep the same order, and don't add or remove any cards.",
    "",
    'Reply with only the updated list in the same format (word - definition, one card per line) inside a single code block, so I can paste it straight back into my flashcard app.',
    "",
    list,
  ].join("\n");
}

/** The link that opens a new chat, prefilled with the prompt when it fits. */
export function buildAiChatUrl(provider: AiProvider, prompt: string): { url: string; prefilled: boolean } {
  const url = PREFILL_URLS[provider] + encodeURIComponent(prompt);
  if (url.length <= MAX_PREFILL_URL_LENGTH) return { url, prefilled: true };
  return { url: HOME_URLS[provider], prefilled: false };
}

function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}
