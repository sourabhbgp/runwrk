/**
 * Tests for feed.ts — tweet normalization, spam detection, and workflow feed filters.
 *
 * Mocks the memory module so isSpam's blocked-account check doesn't hit disk.
 * Uses factory helpers from mock-data for consistent, focused test data.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock memory module — isSpam delegates to isBlocked, and fetchFeed helpers call hasRepliedTo/hasLiked
vi.mock("@/modules/twitter/memory", () => ({
  isBlocked: vi.fn(() => false),
  hasRepliedTo: vi.fn(() => false),
  hasLiked: vi.fn(() => false),
}));

import {
  normalizeTweet,
  isSpam,
  applyWorkflowFilters,
  boostWatchAccounts,
  type FeedItem,
} from "@/modules/twitter/feed";
import { isBlocked } from "@/modules/twitter/memory";
import {
  createMockFeedItem,
  createMockWorkflowConfig,
} from "../../helpers/mock-data";

// Reset memory mocks before each test to avoid cross-test contamination.
// restoreMocks removes the implementation for vi.fn() factories, so we
// re-apply the default return values explicitly.
beforeEach(() => {
  vi.mocked(isBlocked).mockReturnValue(false);
});

// --- normalizeTweet ---

describe("normalizeTweet", () => {
  it("returns null for null input", () => {
    expect(normalizeTweet(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeTweet(undefined)).toBeNull();
  });

  it("returns null when raw.id is missing", () => {
    expect(normalizeTweet({ fullText: "hello" })).toBeNull();
    expect(normalizeTweet({ id: "" })).toBeNull();
  });

  it("maps rettiwt fields to the normalized tweet shape", () => {
    const raw = {
      id: "tweet-abc",
      fullText: "Hello from rettiwt",
      tweetBy: {
        userName: "alice",
        id: "user-123",
        followersCount: 5000,
      },
      likeCount: 42,
      retweetCount: 7,
      replyCount: 3,
      createdAt: "2026-02-20T10:00:00Z",
    };

    const result = normalizeTweet(raw);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("tweet-abc");
    expect(result!.text).toBe("Hello from rettiwt");
    expect(result!.username).toBe("alice");
    expect(result!.userId).toBe("user-123");
    expect(result!.likes).toBe(42);
    expect(result!.retweets).toBe(7);
    expect(result!.replies).toBe(3);
    expect(result!.createdAt).toBe("2026-02-20T10:00:00Z");
    expect(result!.followers).toBe(5000);
  });

  it("falls back to defaults for missing optional fields", () => {
    const raw = { id: "tweet-minimal" };

    const result = normalizeTweet(raw);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("");
    expect(result!.username).toBe("unknown");
    expect(result!.userId).toBe("");
    expect(result!.likes).toBe(0);
    expect(result!.retweets).toBe(0);
    expect(result!.replies).toBe(0);
    expect(result!.followers).toBe(0);
    // createdAt should be a valid ISO string (set to now)
    expect(result!.createdAt).toBeTruthy();
  });

  it("prefers fullText over text when both are present", () => {
    const raw = {
      id: "tweet-dual",
      fullText: "This is the full text version",
      text: "This is the short text version",
    };

    const result = normalizeTweet(raw);

    expect(result!.text).toBe("This is the full text version");
  });
});

// --- isSpam ---

describe("isSpam", () => {
  it("returns false for a normal tweet", () => {
    const tweet = createMockFeedItem({
      tweet: { text: "Just shipped a new feature in our TypeScript project!" },
    }).tweet;

    expect(isSpam(tweet)).toBe(false);
  });

  it("returns true when text contains a spam keyword (giveaway)", () => {
    const tweet = createMockFeedItem({
      tweet: { text: "Free GIVEAWAY! Win a MacBook Pro today!" },
    }).tweet;

    expect(isSpam(tweet)).toBe(true);
  });

  it("returns true when text contains 'airdrop'", () => {
    const tweet = createMockFeedItem({
      tweet: { text: "Huge airdrop coming for all holders" },
    }).tweet;

    expect(isSpam(tweet)).toBe(true);
  });

  it("returns true when text contains 'follow and retweet'", () => {
    const tweet = createMockFeedItem({
      tweet: { text: "Follow and retweet to enter this contest!" },
    }).tweet;

    expect(isSpam(tweet)).toBe(true);
  });

  it("returns true for high retweet-to-reply ratio (engagement bait)", () => {
    // retweets > 50 and ratio > 20 → spam
    const tweet = createMockFeedItem({
      tweet: {
        text: "Interesting thought on coding practices",
        retweets: 1000,
        replies: 2,
      },
    }).tweet;

    expect(isSpam(tweet)).toBe(true);
  });

  it("returns true when the user is on the global blocklist", () => {
    vi.mocked(isBlocked).mockReturnValue(true);

    const tweet = createMockFeedItem({
      tweet: { text: "Totally normal tweet", username: "blockeduser" },
    }).tweet;

    expect(isSpam(tweet)).toBe(true);
  });

  it("returns false for high retweets but proportional replies (ratio < 20)", () => {
    // 200 retweets / 50 replies = ratio of 4, well below the 20 threshold
    const tweet = createMockFeedItem({
      tweet: {
        text: "A genuinely viral but legitimate tweet",
        retweets: 200,
        replies: 50,
      },
    }).tweet;

    expect(isSpam(tweet)).toBe(false);
  });
});

// --- applyWorkflowFilters ---

describe("applyWorkflowFilters", () => {
  /** Helper to build a set of test feed items with varying properties */
  function buildTestItems(): FeedItem[] {
    return [
      createMockFeedItem({
        tweet: {
          text: "Loving #typescript and #react today",
          followers: 1000,
          username: "alice",
        },
      }),
      createMockFeedItem({
        tweet: {
          text: "Just learning javascript basics",
          followers: 50,
          username: "bob",
        },
      }),
      createMockFeedItem({
        tweet: {
          text: "Deep dive into #nodejs performance",
          followers: 3000,
          username: "carol",
        },
      }),
      createMockFeedItem({
        tweet: {
          text: "Random tweet about cooking recipes",
          followers: 800,
          username: "dave",
        },
      }),
    ];
  }

  it("returns all items when workflow has no feedFilters", () => {
    const items = buildTestItems();
    const workflow = createMockWorkflowConfig({ feedFilters: {} });

    const result = applyWorkflowFilters(items, workflow);

    expect(result).toHaveLength(4);
  });

  it("returns all items when no workflow is provided", () => {
    const items = buildTestItems();

    const result = applyWorkflowFilters(items, undefined);

    expect(result).toHaveLength(4);
  });

  it("filters by minFollowers — items below threshold are removed", () => {
    const items = buildTestItems();
    const workflow = createMockWorkflowConfig({
      feedFilters: { minFollowers: 500 },
    });

    const result = applyWorkflowFilters(items, workflow);

    // bob (50 followers) should be filtered out
    expect(result).toHaveLength(3);
    expect(result.every((i) => i.tweet.followers >= 500)).toBe(true);
    expect(result.find((i) => i.tweet.username === "bob")).toBeUndefined();
  });

  it("filters by requireHashtags — items without a matching hashtag are removed", () => {
    const items = buildTestItems();
    const workflow = createMockWorkflowConfig({
      feedFilters: { requireHashtags: ["typescript", "nodejs"] },
    });

    const result = applyWorkflowFilters(items, workflow);

    // alice (#typescript, #react) and carol (#nodejs) match; bob and dave do not
    expect(result).toHaveLength(2);
    const usernames = result.map((i) => i.tweet.username);
    expect(usernames).toContain("alice");
    expect(usernames).toContain("carol");
  });

  it("filters by requireKeywords — items without a matching keyword are removed", () => {
    const items = buildTestItems();
    const workflow = createMockWorkflowConfig({
      feedFilters: { requireKeywords: ["typescript", "cooking"] },
    });

    const result = applyWorkflowFilters(items, workflow);

    // alice (has "typescript") and dave (has "cooking") match
    expect(result).toHaveLength(2);
    const usernames = result.map((i) => i.tweet.username);
    expect(usernames).toContain("alice");
    expect(usernames).toContain("dave");
  });

  it("returns empty array when all items are filtered out", () => {
    const items = buildTestItems();
    const workflow = createMockWorkflowConfig({
      feedFilters: { minFollowers: 100_000 },
    });

    const result = applyWorkflowFilters(items, workflow);

    expect(result).toEqual([]);
  });

  it("passes through items meeting all filter criteria simultaneously", () => {
    const items = buildTestItems();
    const workflow = createMockWorkflowConfig({
      feedFilters: {
        minFollowers: 500,
        requireHashtags: ["typescript"],
      },
    });

    const result = applyWorkflowFilters(items, workflow);

    // Only alice: has #typescript AND 1000 followers (>= 500)
    expect(result).toHaveLength(1);
    expect(result[0].tweet.username).toBe("alice");
  });
});

// --- boostWatchAccounts ---

describe("boostWatchAccounts", () => {
  it("boosts priority by 50 for tweets from watched accounts", () => {
    const items = [
      createMockFeedItem({ tweet: { username: "levelsio" }, priority: 20 }),
      createMockFeedItem({ tweet: { username: "random_user" }, priority: 20 }),
    ];

    boostWatchAccounts(items, ["levelsio"]);

    expect(items[0].priority).toBe(70); // 20 + 50
    expect(items[1].priority).toBe(20); // unchanged
  });

  it("performs case-insensitive matching on usernames", () => {
    const items = [
      createMockFeedItem({ tweet: { username: "Karpathy" }, priority: 30 }),
      createMockFeedItem({ tweet: { username: "SWYX" }, priority: 30 }),
    ];

    boostWatchAccounts(items, ["karpathy", "swyx"]);

    expect(items[0].priority).toBe(80); // 30 + 50
    expect(items[1].priority).toBe(80); // 30 + 50
  });

  it("does nothing when watchAccounts list is empty", () => {
    const items = [
      createMockFeedItem({ tweet: { username: "someone" }, priority: 40 }),
    ];

    boostWatchAccounts(items, []);

    expect(items[0].priority).toBe(40); // unchanged
  });

  it("does nothing when no items match any watch account", () => {
    const items = [
      createMockFeedItem({ tweet: { username: "alice" }, priority: 25 }),
      createMockFeedItem({ tweet: { username: "bob" }, priority: 25 }),
    ];

    boostWatchAccounts(items, ["levelsio", "swyx"]);

    expect(items[0].priority).toBe(25);
    expect(items[1].priority).toBe(25);
  });

  it("boosts multiple items from different watch accounts", () => {
    const items = [
      createMockFeedItem({ tweet: { username: "levelsio" }, priority: 10 }),
      createMockFeedItem({ tweet: { username: "swyx" }, priority: 20 }),
      createMockFeedItem({ tweet: { username: "random" }, priority: 30 }),
    ];

    boostWatchAccounts(items, ["levelsio", "swyx", "karpathy"]);

    expect(items[0].priority).toBe(60); // 10 + 50
    expect(items[1].priority).toBe(70); // 20 + 50
    expect(items[2].priority).toBe(30); // unchanged
  });
});
