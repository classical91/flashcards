import { describe, expect, it } from "vitest";
import { parsePastedFlashcards } from "../../data/deckBuilder";
import { MAX_PREFILL_URL_LENGTH, buildAiChatUrl, buildDefinitionRefreshPrompt } from "../aiExport";

const cards = [
  { term: "adaptable", definition: "able to adjust easily" },
  { term: "admirable", definition: "deserving\nrespect" },
];

describe("buildDefinitionRefreshPrompt", () => {
  it("lists every card on one line in a format Bulk import reads back", () => {
    const prompt = buildDefinitionRefreshPrompt("Week 1", cards);
    const listLines = prompt.split("\n").slice(-cards.length).join("\n");
    expect(listLines).toBe("adaptable - able to adjust easily\nadmirable - deserving respect");
    expect(parsePastedFlashcards(listLines).cards).toEqual([
      { term: "adaptable", definition: "able to adjust easily" },
      { term: "admirable", definition: "deserving respect" },
    ]);
  });

  it("names the deck and asks for unique, up-to-date definitions", () => {
    const prompt = buildDefinitionRefreshPrompt("Week 1", cards);
    expect(prompt).toContain('"Week 1"');
    expect(prompt).toContain("up to date");
    expect(prompt).toContain("unique");
  });
});

describe("buildAiChatUrl", () => {
  it("prefills a short prompt into each provider's new-chat link", () => {
    expect(buildAiChatUrl("chatgpt", "hi there")).toEqual({
      url: "https://chatgpt.com/?q=hi%20there",
      prefilled: true,
    });
    expect(buildAiChatUrl("claude", "hi").url).toBe("https://claude.ai/new?q=hi");
    expect(buildAiChatUrl("grok", "hi").url).toBe("https://grok.com/?q=hi");
  });

  it("falls back to a blank chat when the prompt is too long for a link", () => {
    const result = buildAiChatUrl("claude", "x".repeat(MAX_PREFILL_URL_LENGTH));
    expect(result).toEqual({ url: "https://claude.ai/new", prefilled: false });
  });
});
