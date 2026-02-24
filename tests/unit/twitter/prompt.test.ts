/**
 * Tests for the system prompt builder — verifies that buildSystemPrompt
 * correctly assembles global config, workflow-specific strategy, action
 * bias, blocked accounts, and working memory block into the final
 * Claude system prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock config and memory modules so buildSystemPrompt doesn't touch disk
vi.mock("@/modules/twitter/config", () => ({
  readConfig: vi.fn(() => ({
    topics: ["javascript", "typescript"],
    keywords: [],
    watchAccounts: [],
    limits: {
      maxLikesPerSession: 10,
      maxRepliesPerSession: 5,
      maxPostsPerDay: 3,
      delayBetweenActions: [2000, 5000],
    },
  })),
}));

vi.mock("@/modules/twitter/memory", () => ({
  getWorkingMemoryBlock: vi.fn(() => "No memory data yet."),
  getBlockedAccounts: vi.fn(() => []),
}));

import { buildSystemPrompt } from "@/modules/twitter/prompt";
import { createMockWorkflowConfig } from "../../helpers/mock-data";

// Import mocked functions so we can override return values in specific tests
import { getWorkingMemoryBlock, getBlockedAccounts } from "@/modules/twitter/memory";

const mockGetWorkingMemoryBlock = getWorkingMemoryBlock as Mock;
const mockGetBlockedAccounts = getBlockedAccounts as Mock;

// --- Without Workflow ---

describe("buildSystemPrompt (no workflow)", () => {
  beforeEach(() => {
    mockGetWorkingMemoryBlock.mockReturnValue("No memory data yet.");
    mockGetBlockedAccounts.mockReturnValue([]);
  });

  it("includes global config topics in the prompt", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("javascript");
    expect(prompt).toContain("typescript");
  });

  it("includes voice/style guidelines", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Voice & Style");
    expect(prompt).toContain("natural, conversational tone");
  });

  it("includes safety rules", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Safety Rules");
    expect(prompt).toContain("NEVER spam");
  });
});

// --- With Workflow ---

describe("buildSystemPrompt (with workflow)", () => {
  beforeEach(() => {
    mockGetWorkingMemoryBlock.mockReturnValue("No memory data yet.");
    mockGetBlockedAccounts.mockReturnValue([]);
  });

  it("uses workflow topics instead of global config topics", () => {
    const workflow = createMockWorkflowConfig({
      topics: ["rust", "systems-programming"],
    });

    const prompt = buildSystemPrompt(workflow);

    // Workflow topics should appear
    expect(prompt).toContain("rust");
    expect(prompt).toContain("systems-programming");

    // Global topics should NOT appear (workflow takes precedence)
    expect(prompt).not.toContain("javascript");
  });

  it("includes Strategy section when workflow has a strategyPrompt", () => {
    const workflow = createMockWorkflowConfig({
      strategyPrompt: "Focus on engaging with senior engineers.",
    });

    const prompt = buildSystemPrompt(workflow);
    expect(prompt).toContain("## Strategy");
    expect(prompt).toContain("Focus on engaging with senior engineers.");
  });

  it("includes Action Preferences section when workflow has actionBias", () => {
    const workflow = createMockWorkflowConfig({
      actionBias: {
        reply: "heavy",
        like: "light",
        retweet: "moderate",
        originalPost: "heavy",
        follow: "light",
      },
    });

    const prompt = buildSystemPrompt(workflow);
    expect(prompt).toContain("## Action Preferences");
    expect(prompt).toContain("Replies: heavy");
    expect(prompt).toContain("Likes: light");
  });

  it("falls back to global config topics when workflow has empty topics", () => {
    const workflow = createMockWorkflowConfig({ topics: [] });

    const prompt = buildSystemPrompt(workflow);

    // Should fall back to global config topics
    expect(prompt).toContain("javascript");
    expect(prompt).toContain("typescript");
  });
});

// --- Memory-Driven Sections ---

describe("buildSystemPrompt (memory interactions)", () => {
  beforeEach(() => {
    mockGetWorkingMemoryBlock.mockReturnValue("No memory data yet.");
    mockGetBlockedAccounts.mockReturnValue([]);
  });

  it("includes User Directives section when working memory has directives", () => {
    mockGetWorkingMemoryBlock.mockReturnValue(
      "### User Directives\n- Always be concise\n- Avoid memes\n" +
      "Follow these directives strictly — they reflect the user's explicit preferences.",
    );

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("User Directives");
    expect(prompt).toContain("Always be concise");
    expect(prompt).toContain("Avoid memes");
  });

  it("includes skip patterns when working memory has them", () => {
    mockGetWorkingMemoryBlock.mockReturnValue(
      "### Learned Skip Patterns\n- crypto/NFT tweets (5x)\n- self-promotion threads (3x)\n" +
      "Skip tweets matching these patterns proactively.",
    );

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Skip Patterns");
    expect(prompt).toContain("crypto/NFT tweets");
    expect(prompt).toContain("self-promotion threads");
  });

  it("includes blocked accounts in the prompt when present", () => {
    mockGetBlockedAccounts.mockReturnValue(["spammer42", "scambot99"]);

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("@spammer42");
    expect(prompt).toContain("@scambot99");
  });
});
