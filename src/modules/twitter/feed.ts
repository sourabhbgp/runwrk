/**
 * feed.ts — Fetch and organize tweets from multiple sources into a prioritized feed.
 *
 * Aggregates three sources: mentions (notifications), timeline (followed accounts),
 * and discovery (keyword search). Applies spam pre-filtering using keyword heuristics
 * and the blocked accounts list from memory. Returns items sorted by priority.
 */

import { searchTweets, getFollowedFeed, getNotifications, getTweetDetails } from "./api";
import { readConfig } from "./config";
import { hasRepliedTo, hasLiked, isBlocked } from "./memory";

// --- Types ---

/** A single feed item with source type, tweet data, priority score, and engagement status */
export type FeedItem = {
  type: "mention" | "timeline" | "discovery";
  tweet: {
    id: string;
    text: string;
    username: string;
    userId: string;
    likes: number;
    retweets: number;
    replies: number;
    createdAt: string;
  };
  thread?: { id: string; text: string; username: string }[];
  priority: number;
  alreadyEngaged: boolean;
};

// --- Tweet Normalization ---

/** Convert raw rettiwt API response into a consistent tweet shape, or null if invalid */
function normalizeTweet(raw: any): FeedItem["tweet"] | null {
  if (!raw || !raw.id) return null;
  return {
    id: raw.id,
    text: raw.fullText ?? raw.text ?? "",
    username: raw.tweetBy?.userName ?? raw.tweetBy?.username ?? "unknown",
    userId: raw.tweetBy?.id ?? "",
    likes: raw.likeCount ?? 0,
    retweets: raw.retweetCount ?? 0,
    replies: raw.replyCount ?? 0,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

// --- Spam Pre-Filter ---

/** Common spam/promotional phrases used to detect low-quality tweets before they reach Claude */
const SPAM_KEYWORDS = [
  "giveaway", "win free", "airdrop", "dm me", "follow and retweet",
  "follow & retweet", "portfolio update", "join my", "sign up now",
  "limited spots", "whitelist", "presale", "free mint", "claim your",
  "not financial advice", "100x", "moonshot", "drop your wallet",
  "retweet to win", "like and retweet", "like & retweet",
];

/** Check if a tweet is spam using blocked accounts, keyword heuristics,
 *  and engagement ratio analysis. Spam tweets are silently dropped from the feed. */
function isSpam(tweet: FeedItem["tweet"]): boolean {
  // Permanently blocked accounts always get filtered
  if (isBlocked(tweet.username)) return true;

  const textLower = tweet.text.toLowerCase();

  // Match against known spam/promotional keywords
  if (SPAM_KEYWORDS.some((kw) => textLower.includes(kw))) return true;

  // High retweet-to-reply ratio (engagement bait): many RTs but almost no replies
  // Typical of "follow & RT to win" posts that farm engagement
  if (tweet.retweets > 50 && tweet.replies > 0 && tweet.retweets / tweet.replies > 20) return true;

  return false;
}

// --- Feed Fetching ---

/** Fetch tweets from all sources (mentions, timeline, discovery), apply filters,
 *  and return a sorted list with priority scores and per-source counts. */
export async function fetchFeed(): Promise<{
  items: FeedItem[];
  counts: { mentions: number; timeline: number; discovery: number };
}> {
  const config = readConfig();
  const items: FeedItem[] = [];

  // 1. Mentions / Notifications (highest priority — someone explicitly tagged us)
  try {
    const notifications = await getNotifications(20);
    for (const notif of notifications) {
      const tweet = normalizeTweet(notif);
      if (!tweet) continue;
      const engaged = hasRepliedTo(tweet.id) || hasLiked(tweet.id);
      items.push({
        type: "mention",
        tweet,
        priority: 100,
        alreadyEngaged: engaged,
      });
    }
  } catch {
    // Notifications may not be available — continue with other sources
  }

  // 2. Timeline (followed accounts, filtered by configured topics/keywords)
  try {
    const timeline = await getFollowedFeed();
    const lowerTopics = [...config.topics, ...config.keywords].map((t) => t.toLowerCase());

    for (const raw of timeline) {
      const tweet = normalizeTweet(raw);
      if (!tweet) continue;
      if (isSpam(tweet)) continue;
      const textLower = tweet.text.toLowerCase();
      // Only include tweets matching configured topics (or all if no topics set)
      const relevant = lowerTopics.length === 0 || lowerTopics.some((t) => textLower.includes(t));
      if (!relevant) continue;

      const engaged = hasRepliedTo(tweet.id) || hasLiked(tweet.id);
      items.push({
        type: "timeline",
        tweet,
        // Priority boosts with likes, capped at 30 bonus
        priority: 50 + Math.min(tweet.likes, 30),
        alreadyEngaged: engaged,
      });
    }
  } catch {
    // Timeline fetch failed — continue with other sources
  }

  // 3. Discovery (keyword search — find new conversations to join)
  try {
    const queries = [...config.keywords, ...config.topics].slice(0, 3);
    for (const q of queries) {
      const results = await searchTweets({ includeWords: [q] }, 10);
      for (const raw of results) {
        const tweet = normalizeTweet(raw);
        if (!tweet) continue;
        if (isSpam(tweet)) continue;
        // Deduplicate — skip tweets already added from timeline or other queries
        if (items.some((i) => i.tweet.id === tweet.id)) continue;

        const engaged = hasRepliedTo(tweet.id) || hasLiked(tweet.id);
        items.push({
          type: "discovery",
          tweet,
          // Lower base priority than timeline; likes give a smaller boost
          priority: 20 + Math.min(tweet.likes / 10, 20),
          alreadyEngaged: engaged,
        });
      }
    }
  } catch {
    // Search failed — continue with whatever we have
  }

  // Sort: unanswered tweets first, then by descending priority
  items.sort((a, b) => {
    if (a.alreadyEngaged !== b.alreadyEngaged) return a.alreadyEngaged ? 1 : -1;
    return b.priority - a.priority;
  });

  return {
    items,
    counts: {
      mentions: items.filter((i) => i.type === "mention").length,
      timeline: items.filter((i) => i.type === "timeline").length,
      discovery: items.filter((i) => i.type === "discovery").length,
    },
  };
}

// --- Thread Context ---

/** Fetch parent tweet(s) for thread context. Used to give Claude
 *  conversation context when analyzing mentions that are replies. */
export async function fetchThread(tweetId: string): Promise<FeedItem["thread"]> {
  try {
    const tweet = await getTweetDetails(tweetId);
    if (!tweet) return undefined;
    // If the tweet is a reply, fetch the parent for context
    const thread: FeedItem["thread"] = [];
    if (tweet.replyTo) {
      const parent = await getTweetDetails(tweet.replyTo);
      if (parent) {
        thread.push({
          id: parent.id,
          text: parent.fullText ?? parent.text ?? "",
          username: parent.tweetBy?.userName ?? "unknown",
        });
      }
    }
    return thread.length > 0 ? thread : undefined;
  } catch {
    return undefined;
  }
}
