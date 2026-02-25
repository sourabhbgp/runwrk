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
      maxFollowsPerSession: 3,
      maxPostsPerDay: 3,
      delayBetweenActions: [2000, 5000],
    },
  })),
}));

vi.mock("@/modules/twitter/memory", () => ({
  getWorkingMemoryBlock: vi.fn(() => "No memory data yet."),
  getBlockedAccounts: vi.fn(() => []),
}));

import { buildSystemPrompt, buildActionGuidance } from "@/modules/twitter/prompt";
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

  it("includes safety rules with quality-and-quantity guidance", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("Safety Rules");
    expect(prompt).toContain("NEVER spam");
    // New phrasing encourages engagement over skipping
    expect(prompt).toContain("quality AND quantity");
    expect(prompt).toContain("always better than skipping");
    // Old skip-encouraging phrasing should be gone
    expect(prompt).not.toContain("better to skip than post a generic reply");
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

  it("includes Action Preferences with behavioral guidance when workflow has actionBias", () => {
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
    // Should contain specific guidance, not just the label
    expect(prompt).toContain("**Reply** (heavy)");
    expect(prompt).toContain("60-70%");
    expect(prompt).toContain("**Like** (light)");
    expect(prompt).toContain("sparingly");
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

// --- Reply Strategy Section ---

describe("buildSystemPrompt (Reply Strategy)", () => {
  beforeEach(() => {
    mockGetWorkingMemoryBlock.mockReturnValue("No memory data yet.");
    mockGetBlockedAccounts.mockReturnValue([]);
  });

  it("includes Reply Strategy section when reply bias is heavy", () => {
    const workflow = createMockWorkflowConfig({
      actionBias: {
        reply: "heavy",
        like: "moderate",
        retweet: "light",
        originalPost: "moderate",
        follow: "moderate",
      },
    });

    const prompt = buildSystemPrompt(workflow);
    expect(prompt).toContain("## Reply Strategy");
    expect(prompt).toContain("thoughtful questions");
    expect(prompt).toContain("75x algorithm weight");
    expect(prompt).toContain("NEVER start with");
    expect(prompt).toContain("1-3 sentences");
  });

  it("does NOT include Reply Strategy section when reply bias is moderate", () => {
    const workflow = createMockWorkflowConfig({
      actionBias: {
        reply: "moderate",
        like: "moderate",
        retweet: "moderate",
        originalPost: "moderate",
        follow: "moderate",
      },
    });

    const prompt = buildSystemPrompt(workflow);
    expect(prompt).not.toContain("## Reply Strategy");
  });

  it("does NOT include Reply Strategy section when reply bias is light", () => {
    const workflow = createMockWorkflowConfig({
      actionBias: {
        reply: "light",
        like: "moderate",
        retweet: "moderate",
        originalPost: "moderate",
        follow: "moderate",
      },
    });

    const prompt = buildSystemPrompt(workflow);
    expect(prompt).not.toContain("## Reply Strategy");
  });
});

// --- buildActionGuidance ---

describe("buildActionGuidance", () => {
  it("returns specific guidance for known action + level combinations", () => {
    const result = buildActionGuidance("Reply", "heavy");
    expect(result).toContain("**Reply** (heavy)");
    expect(result).toContain("60-70%");
  });

  it("returns specific guidance for moderate level", () => {
    const result = buildActionGuidance("Like", "moderate");
    expect(result).toContain("**Like** (moderate)");
    expect(result).toContain("genuinely interesting");
  });

  it("returns specific guidance for light level", () => {
    const result = buildActionGuidance("Retweet", "light");
    expect(result).toContain("**Retweet** (light)");
    expect(result).toContain("Rarely retweet");
  });

  it("falls back to plain label for unknown action", () => {
    const result = buildActionGuidance("UnknownAction", "heavy");
    expect(result).toBe("- **UnknownAction**: heavy\n");
  });

  it("falls back to plain label for unknown level", () => {
    const result = buildActionGuidance("Reply", "extreme");
    expect(result).toBe("- **Reply**: extreme\n");
  });
});
