/**
 * mock-data.ts — Factory functions for typed test data with sensible defaults.
 *
 * Each factory accepts partial overrides so tests only specify the fields they
 * care about, keeping test code focused on what matters.
 */

import type { FeedItem } from "@/modules/twitter/feed";
import type { WorkflowConfig } from "@/modules/twitter/workflow.types";
import type { TwitterMemory } from "@/modules/twitter/memory";

// --- Feed Items ---

/** Create a mock feed item with sensible defaults, overridable per-field */
export function createMockFeedItem(overrides?: Omit<Partial<FeedItem>, "tweet"> & { tweet?: Partial<FeedItem["tweet"]> }): FeedItem {
  const { tweet: tweetOverrides, ...rest } = overrides ?? {};
  const tweet: FeedItem["tweet"] = {
    id: "tweet-123",
    text: "This is a great tweet about TypeScript",
    username: "testuser",
    userId: "user-456",
    likes: 10,
    retweets: 2,
    replies: 3,
    createdAt: "2026-01-15T12:00:00Z",
    followers: 500,
    ...tweetOverrides,
  };
  return {
    type: "timeline",
    tweet,
    priority: 50,
    alreadyEngaged: false,
    ...rest,
  };
}

/** Create a feed item that matches common spam patterns */
export function createSpamFeedItem(overrides?: Partial<FeedItem["tweet"]>): FeedItem {
  return createMockFeedItem({
    tweet: {
      text: "🔥 FREE GIVEAWAY! Follow and retweet to win $10,000! Drop your wallet address!",
      username: "spambot99",
      likes: 500,
      retweets: 200,
      replies: 1,
      ...overrides,
    },
  });
}

// --- Workflow Configs ---

/** Create a mock workflow config with sensible defaults */
export function createMockWorkflowConfig(overrides?: Partial<WorkflowConfig>): WorkflowConfig {
  return {
    name: "test-workflow",
    template: "custom",
    description: "A test workflow",
    createdAt: "2026-01-15T12:00:00Z",
    strategyPrompt: "Be helpful and engaging.",
    topics: ["typescript", "webdev"],
    keywords: ["react", "nodejs"],
    watchAccounts: [],
    feedPriority: { mentions: 100, timeline: 50, discovery: 20 },
    feedFilters: {},
    actionBias: {
      reply: "moderate",
      like: "moderate",
      retweet: "moderate",
      originalPost: "moderate",
      follow: "moderate",
    },
    limits: {
      maxLikesPerSession: 12,
      maxRepliesPerSession: 17,
      maxPostsPerDay: 5,
      delayBetweenActions: [1500, 4000],
    },
    params: {},
    ...overrides,
  };
}

// --- Twitter Memory ---

/** Create an empty twitter memory with optional overrides */
export function createMockMemory(overrides?: Partial<TwitterMemory>): TwitterMemory {
  return {
    repliedTo: [],
    liked: [],
    retweeted: [],
    posted: [],
    followed: [],
    dailyStats: {},
    skipped: [],
    blockedAccounts: [],
    feedback: [],
    ...overrides,
  };
}
