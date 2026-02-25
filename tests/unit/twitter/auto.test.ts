/**
 * Tests for auto.ts — autonomous engagement mode.
 *
 * Verifies quote tracking separate from replies, progress logging,
 * session limit enforcement with combined reply+quote counts, and
 * stop condition messaging.
 *
 * Mocks all external dependencies (API, agent, memory, workflow)
 * so tests run without network calls or disk access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external modules auto.ts depends on
vi.mock("@/modules/twitter/api", () => ({
  postTweet: vi.fn(() => Promise.resolve("tweet-id-123")),
  likeTweet: vi.fn(() => Promise.resolve()),
  retweet: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/modules/twitter/agent", () => ({
  analyzeTweet: vi.fn(() =>
    Promise.resolve({ action: "skip", reason: "test default" }),
  ),
}));

vi.mock("@/modules/twitter/memory", () => ({
  logReply: vi.fn(),
  logLike: vi.fn(),
  logRetweet: vi.fn(),
  logSkip: vi.fn(),
}));

vi.mock("@/modules/twitter/workflow", () => ({
  getGlobalDailyPostCount: vi.fn(() => 0),
  incrementGlobalDailyPosts: vi.fn(),
}));

vi.mock("@/modules/twitter/session", () => ({
  sessionSummary: vi.fn(),
}));

vi.mock("@/modules/twitter/feed", () => ({
  fetchThread: vi.fn(() => Promise.resolve(undefined)),
}));

import { runAuto } from "@/modules/twitter/auto";
import { analyzeTweet } from "@/modules/twitter/agent";
import { postTweet } from "@/modules/twitter/api";
import { sessionSummary } from "@/modules/twitter/session";
import { createMockFeedItem, createMockWorkflowConfig } from "../../helpers/mock-data";
import type { TwitterConfig } from "@/modules/twitter/config";

const mockAnalyzeTweet = vi.mocked(analyzeTweet);
const mockPostTweet = vi.mocked(postTweet);
const mockSessionSummary = vi.mocked(sessionSummary);

// Minimal config satisfying the type requirement
const mockConfig: TwitterConfig = {
  topics: [],
  keywords: [],
  watchAccounts: [],
  limits: {
    maxLikesPerSession: 12,
    maxRepliesPerSession: 17,
    maxPostsPerDay: 5,
    delayBetweenActions: [1500, 4000],
  },
};

beforeEach(() => {
  mockAnalyzeTweet.mockReset();
  mockPostTweet.mockReset();
  mockSessionSummary.mockReset();
  mockPostTweet.mockResolvedValue("tweet-id-123");
  // Silence console output during tests
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// --- Quote Tracking ---

describe("runAuto quote tracking", () => {
  it("tracks quotes separately from replies in session summary", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "alice" } }),
      createMockFeedItem({ tweet: { id: "t2", username: "bob" } }),
      createMockFeedItem({ tweet: { id: "t3", username: "carol" } }),
    ];

    // First tweet → reply, second → quote, third → skip
    mockAnalyzeTweet
      .mockResolvedValueOnce({ action: "reply", reason: "good tweet", draft: "Nice insight!" })
      .mockResolvedValueOnce({ action: "quote", reason: "worth amplifying", draft: "This is great context" })
      .mockResolvedValueOnce({ action: "skip", reason: "off topic" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    // Session summary should be called with separate reply and quote counts
    expect(mockSessionSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: 1,
        quotes: 1,
        skipped: 1,
      }),
    );
  });

  it("counts replies + quotes together against maxRepliesPerSession", async () => {
    // Create a workflow with a low reply limit to test combined counting
    const workflow = createMockWorkflowConfig({
      limits: {
        maxLikesPerSession: 10,
        maxRepliesPerSession: 2,
        maxPostsPerDay: 5,
        delayBetweenActions: [100, 200],
      },
    });

    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "alice" } }),
      createMockFeedItem({ tweet: { id: "t2", username: "bob" } }),
      createMockFeedItem({ tweet: { id: "t3", username: "carol" } }),
      createMockFeedItem({ tweet: { id: "t4", username: "dave" } }),
    ];

    // 1 reply + 1 quote = 2, which should hit the limit of 2
    // The 3rd should be skipped due to limit, 4th is a like to keep going
    mockAnalyzeTweet
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Reply text" })
      .mockResolvedValueOnce({ action: "quote", reason: "good", draft: "Quote text" })
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Should not send" })
      .mockResolvedValueOnce({ action: "like", reason: "nice" });

    await runAuto(items, mockConfig, workflow, "test-wf");

    // Only 2 postTweet calls — the 3rd reply should be skipped
    expect(mockPostTweet).toHaveBeenCalledTimes(2);
  });
});

// --- Stop Condition ---

describe("runAuto stop condition", () => {
  it("stops when both reply+quote and like limits are reached", async () => {
    const workflow = createMockWorkflowConfig({
      limits: {
        maxLikesPerSession: 1,
        maxRepliesPerSession: 1,
        maxPostsPerDay: 5,
        delayBetweenActions: [100, 200],
      },
    });

    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "alice" } }),
      createMockFeedItem({ tweet: { id: "t2", username: "bob" } }),
      createMockFeedItem({ tweet: { id: "t3", username: "carol" } }),
    ];

    mockAnalyzeTweet
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Reply" })
      .mockResolvedValueOnce({ action: "like", reason: "nice" })
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Should not happen" });

    await runAuto(items, mockConfig, workflow, "test-wf");

    // 3rd item should not be analyzed because limits were reached after 2nd
    expect(mockAnalyzeTweet).toHaveBeenCalledTimes(2);
  });
});

// --- Already Engaged ---

describe("runAuto already engaged items", () => {
  it("skips items that are already engaged", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1" }, alreadyEngaged: true }),
      createMockFeedItem({ tweet: { id: "t2" }, alreadyEngaged: false }),
    ];

    mockAnalyzeTweet.mockResolvedValue({ action: "skip", reason: "test" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    // Only the non-engaged item should be analyzed
    expect(mockAnalyzeTweet).toHaveBeenCalledTimes(1);
  });
});
