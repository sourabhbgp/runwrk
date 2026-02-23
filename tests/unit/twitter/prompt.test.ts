/**
 * Tests for the system prompt builder — verifies that buildSystemPrompt
 * correctly assembles global config, workflow-specific strategy, action
 * bias, user directives, skip patterns, and blocked accounts into the
 * final Claude system prompt.
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
  getRecentHistory: vi.fn(() => "No recent engagement history."),
  getSkipPatterns: vi.fn(() => ""),
  getBlockedAccounts: vi.fn(() => []),
  getFeedback: vi.fn(() => []),
}));

import { buildSystemPrompt } from "@/modules/twitter/prompt";
import { createMockWorkflowConfig } from "../../helpers/mock-data";

// Import mocked functions so we can override return values in specific tests
import { getSkipPatterns, getBlockedAccounts, getFeedback } from "@/modules/twitter/memory";

const mockGetSkipPatterns = getSkipPatterns as Mock;
const mockGetBlockedAccounts = getBlockedAccounts as Mock;
const mockGetFeedback = getFeedback as Mock;

// --- Without Workflow ---

describe("buildSystemPrompt (no workflow)", () => {
  beforeEach(() => {
    // Reset mocks to defaults before each test
    mockGetSkipPatterns.mockReturnValue("");
    mockGetBlockedAccounts.mockReturnValue([]);
    mockGetFeedback.mockReturnValue([]);
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
    mockGetSkipPatterns.mockReturnValue("");
    mockGetBlockedAccounts.mockReturnValue([]);
    mockGetFeedback.mockReturnValue([]);
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
    mockGetSkipPatterns.mockReturnValue("");
    mockGetBlockedAccounts.mockReturnValue([]);
    mockGetFeedback.mockReturnValue([]);
  });

  it("includes User Directives section when feedback entries exist", () => {
    mockGetFeedback.mockReturnValue([
      "Always be concise",
      "Avoid memes",
    ]);

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("## User Directives");
    expect(prompt).toContain("Always be concise");
    expect(prompt).toContain("Avoid memes");
  });

  it("includes Learned Preferences section when skip patterns exist", () => {
    mockGetSkipPatterns.mockReturnValue(
      "crypto/NFT tweets: skipped 5 times\nself-promotion threads: skipped 3 times",
    );

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("## Learned Preferences");
    expect(prompt).toContain("crypto/NFT tweets");
    expect(prompt).toContain("self-promotion threads");
  });

  it("includes blocked accounts in Learned Preferences when present", () => {
    mockGetBlockedAccounts.mockReturnValue(["spammer42", "scambot99"]);

    const prompt = buildSystemPrompt();
    expect(prompt).toContain("## Learned Preferences");
    expect(prompt).toContain("@spammer42");
    expect(prompt).toContain("@scambot99");
  });
});
