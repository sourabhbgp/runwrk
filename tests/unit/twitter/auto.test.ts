/**
 * Tests for auto.ts — autonomous engagement mode.
 *
 * Verifies quote tracking separate from replies, progress logging,
 * session limit enforcement with combined reply+quote counts,
 * stop condition messaging, and rule-based auto-follow after engagement.
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
  followUser: vi.fn(() => Promise.resolve()),
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
  logFollow: vi.fn(),
  hasFollowed: vi.fn(() => false),
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
import { postTweet, followUser } from "@/modules/twitter/api";
import { logFollow, hasFollowed } from "@/modules/twitter/memory";
import { sessionSummary } from "@/modules/twitter/session";
import { createMockFeedItem, createMockWorkflowConfig } from "../../helpers/mock-data";
import type { TwitterConfig } from "@/modules/twitter/config";

const mockAnalyzeTweet = vi.mocked(analyzeTweet);
const mockPostTweet = vi.mocked(postTweet);
const mockFollowUser = vi.mocked(followUser);
const mockLogFollow = vi.mocked(logFollow);
const mockHasFollowed = vi.mocked(hasFollowed);
const mockSessionSummary = vi.mocked(sessionSummary);

// Minimal config satisfying the type requirement
const mockConfig: TwitterConfig = {
  topics: [],
  keywords: [],
  watchAccounts: [],
  limits: {
    maxLikesPerSession: 12,
    maxRepliesPerSession: 17,
    maxFollowsPerSession: 3,
    maxPostsPerDay: 5,
    delayBetweenActions: [1500, 4000],
  },
};

beforeEach(() => {
  mockAnalyzeTweet.mockReset();
  mockPostTweet.mockReset();
  mockFollowUser.mockReset();
  mockLogFollow.mockReset();
  mockHasFollowed.mockReset();
  mockSessionSummary.mockReset();
  mockPostTweet.mockResolvedValue("tweet-id-123");
  mockFollowUser.mockResolvedValue(undefined);
  mockHasFollowed.mockReturnValue(false);
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
        maxFollowsPerSession: 3,
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
        maxFollowsPerSession: 3,
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

// --- Auto-Follow After Engagement ---

describe("runAuto auto-follow", () => {
  it("follows after a successful reply when author has <5K followers", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "smallacct", userId: "u1", followers: 800 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Great point!" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockFollowUser).toHaveBeenCalledWith("u1", mockConfig);
    expect(mockLogFollow).toHaveBeenCalledWith("u1", "test-wf");
  });

  it("follows after a successful quote when author has <5K followers", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "smallacct", userId: "u1", followers: 2000 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "quote", reason: "amplify", draft: "Exactly this" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockFollowUser).toHaveBeenCalledWith("u1", mockConfig);
    expect(mockLogFollow).toHaveBeenCalledWith("u1", "test-wf");
  });

  it("does NOT follow after a like action", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "someone", userId: "u1", followers: 100 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "like", reason: "nice tweet" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockFollowUser).not.toHaveBeenCalled();
  });

  it("does NOT follow after a skip action", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "someone", userId: "u1", followers: 100 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "skip", reason: "off topic" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockFollowUser).not.toHaveBeenCalled();
  });

  it("does NOT follow accounts with 50K+ followers", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "bigacct", userId: "u1", followers: 75000 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Nice!" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockFollowUser).not.toHaveBeenCalled();
  });

  it("follows 5K-50K accounts only if they are on watchAccounts", async () => {
    const items = [
      // On watchAccounts → should follow
      createMockFeedItem({ tweet: { id: "t1", username: "watched", userId: "u1", followers: 15000 } }),
      // Not on watchAccounts → should not follow
      createMockFeedItem({ tweet: { id: "t2", username: "unwatched", userId: "u2", followers: 20000 } }),
    ];
    mockAnalyzeTweet
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Insightful!" })
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Interesting!" });

    const workflow = createMockWorkflowConfig({ watchAccounts: ["watched"] });
    await runAuto(items, mockConfig, workflow, "test-wf");

    // Only the watched account should be followed
    expect(mockFollowUser).toHaveBeenCalledTimes(1);
    expect(mockFollowUser).toHaveBeenCalledWith("u1", mockConfig);
  });

  it("skips follow if already followed (hasFollowed returns true)", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "already", userId: "u1", followers: 500 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Nice!" });
    mockHasFollowed.mockReturnValue(true);

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockFollowUser).not.toHaveBeenCalled();
  });

  it("respects maxFollowsPerSession limit", async () => {
    // Set follow limit to 1
    const workflow = createMockWorkflowConfig({
      limits: {
        maxLikesPerSession: 12,
        maxRepliesPerSession: 17,
        maxFollowsPerSession: 1,
        maxPostsPerDay: 5,
        delayBetweenActions: [100, 200],
      },
    });

    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "alice", userId: "u1", followers: 500 } }),
      createMockFeedItem({ tweet: { id: "t2", username: "bob", userId: "u2", followers: 300 } }),
    ];
    mockAnalyzeTweet
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Reply 1" })
      .mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Reply 2" });

    await runAuto(items, mockConfig, workflow, "test-wf");

    // Only 1 follow even though both qualify — limit is 1
    expect(mockFollowUser).toHaveBeenCalledTimes(1);
    expect(mockFollowUser).toHaveBeenCalledWith("u1", mockConfig);
  });

  it("includes follow count in session summary", async () => {
    const items = [
      createMockFeedItem({ tweet: { id: "t1", username: "alice", userId: "u1", followers: 500 } }),
    ];
    mockAnalyzeTweet.mockResolvedValueOnce({ action: "reply", reason: "good", draft: "Great!" });

    const workflow = createMockWorkflowConfig();
    await runAuto(items, mockConfig, workflow, "test-wf");

    expect(mockSessionSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        replies: 1,
        follows: 1,
      }),
    );
  });
});
