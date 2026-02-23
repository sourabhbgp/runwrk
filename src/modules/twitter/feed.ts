/**
 * feed.ts — Fetch and organize tweets from multiple sources into a prioritized feed.
 *
 * Aggregates three sources: mentions (notifications), timeline (followed accounts),
 * and discovery (keyword search). Applies spam pre-filtering using keyword heuristics
 * and the blocked accounts list from global safety. When a WorkflowConfig is provided,
 * applies workflow-specific feed priorities, filters, and topic/keyword overrides.
 */

import { searchTweets, getFollowedFeed, getNotifications, getTweetDetails } from "./api";
import { readConfig, type TwitterConfig } from "./config";
import { hasRepliedTo, hasLiked, isBlocked } from "./memory";
import type { WorkflowConfig } from "./workflow.types";

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
    /** Follower count of the tweet author — used for workflow feed filters */
    followers: number;
  };
  thread?: { id: string; text: string; username: string }[];
  priority: number;
  alreadyEngaged: boolean;
};

// --- Tweet Normalization ---

/** Convert raw rettiwt API response into a consistent tweet shape, or null if invalid.
 *  @internal Exported for unit testing only */
export function normalizeTweet(raw: any): FeedItem["tweet"] | null {
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
    followers: raw.tweetBy?.followersCount ?? 0,
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
 *  and engagement ratio analysis. Spam tweets are silently dropped from the feed.
 *  @internal Exported for unit testing only */
export function isSpam(tweet: FeedItem["tweet"]): boolean {
  // Permanently blocked accounts always get filtered (reads from global safety)
  if (isBlocked(tweet.username)) return true;

  const textLower = tweet.text.toLowerCase();

  // Match against known spam/promotional keywords
  if (SPAM_KEYWORDS.some((kw) => textLower.includes(kw))) return true;

  // High retweet-to-reply ratio (engagement bait): many RTs but almost no replies
  if (tweet.retweets > 50 && tweet.replies > 0 && tweet.retweets / tweet.replies > 20) return true;

  return false;
}

// --- Workflow Feed Filters ---

/** Apply workflow-specific filters to a list of feed items.
 *  Filters by minFollowers, requireHashtags, and requireKeywords.
 *  @internal Exported for unit testing only */
export function applyWorkflowFilters(items: FeedItem[], workflow?: WorkflowConfig): FeedItem[] {
  if (!workflow?.feedFilters) return items;

  const filters = workflow.feedFilters;

  return items.filter((item) => {
    // Filter by minimum follower count
    if (filters.minFollowers && item.tweet.followers < filters.minFollowers) {
      return false;
    }

    // Filter by required hashtags — tweet must contain at least one
    if (filters.requireHashtags && filters.requireHashtags.length > 0) {
      const textLower = item.tweet.text.toLowerCase();
      const hasHashtag = filters.requireHashtags.some((tag) =>
        textLower.includes(`#${tag.toLowerCase()}`)
      );
      if (!hasHashtag) return false;
    }

    // Filter by required keywords — tweet must contain at least one
    if (filters.requireKeywords && filters.requireKeywords.length > 0) {
      const textLower = item.tweet.text.toLowerCase();
      const hasKeyword = filters.requireKeywords.some((kw) =>
        textLower.includes(kw.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    return true;
  });
}

// --- Feed Fetching ---

/** Fetch mentions from notifications. Priority comes from workflow or defaults to 100. */
async function fetchMentions(
  workflowName?: string,
  basePriority: number = 100,
): Promise<FeedItem[]> {
  const notifications = await getNotifications(20);
  const items: FeedItem[] = [];
  for (const notif of notifications) {
    const tweet = normalizeTweet(notif);
    if (!tweet) continue;
    const engaged = hasRepliedTo(tweet.id, workflowName) || hasLiked(tweet.id, workflowName);
    items.push({ type: "mention", tweet, priority: basePriority, alreadyEngaged: engaged });
  }
  return items;
}

/** Fetch timeline from followed accounts, filtered by topics/keywords. */
async function fetchTimeline(
  topics: string[],
  keywords: string[],
  workflowName?: string,
  basePriority: number = 50,
): Promise<FeedItem[]> {
  const timeline = await getFollowedFeed();
  const lowerTopics = [...topics, ...keywords].map((t) => t.toLowerCase());
  const items: FeedItem[] = [];

  for (const raw of timeline) {
    const tweet = normalizeTweet(raw);
    if (!tweet) continue;
    if (isSpam(tweet)) continue;
    const textLower = tweet.text.toLowerCase();
    // Only include tweets matching topics (or all if no topics set)
    const relevant = lowerTopics.length === 0 || lowerTopics.some((t) => textLower.includes(t));
    if (!relevant) continue;

    const engaged = hasRepliedTo(tweet.id, workflowName) || hasLiked(tweet.id, workflowName);
    items.push({
      type: "timeline",
      tweet,
      // Priority boosts with likes, capped at 30 bonus
      priority: basePriority + Math.min(tweet.likes, 30),
      alreadyEngaged: engaged,
    });
  }
  return items;
}

/** Fetch discovery tweets via keyword search — find new conversations to join. */
async function fetchDiscovery(
  topics: string[],
  keywords: string[],
  workflowName?: string,
  basePriority: number = 20,
): Promise<FeedItem[]> {
  const queries = [...keywords, ...topics].slice(0, 3);
  const items: FeedItem[] = [];

  for (const q of queries) {
    const results = await searchTweets({ includeWords: [q] }, 10);
    for (const raw of results) {
      const tweet = normalizeTweet(raw);
      if (!tweet) continue;
      if (isSpam(tweet)) continue;

      const engaged = hasRepliedTo(tweet.id, workflowName) || hasLiked(tweet.id, workflowName);
      items.push({
        type: "discovery",
        tweet,
        // Lower base priority; likes give a smaller boost
        priority: basePriority + Math.min(tweet.likes / 10, 20),
        alreadyEngaged: engaged,
      });
    }
  }
  return items;
}

/** Fetch tweets from all sources (mentions, timeline, discovery) in parallel,
 *  apply filters, and return a sorted list with priority scores and per-source counts.
 *  When a workflow is provided, uses its topics/keywords/priorities/filters.
 *  Uses Promise.allSettled so a single source failure doesn't block the others. */
export async function fetchFeed(workflow?: WorkflowConfig, workflowName?: string): Promise<{
  items: FeedItem[];
  counts: { mentions: number; timeline: number; discovery: number };
}> {
  // Determine topics and keywords — workflow overrides global config
  const config = readConfig();
  const topics = workflow && workflow.topics.length > 0 ? workflow.topics : config.topics;
  const keywords = workflow && workflow.keywords.length > 0 ? workflow.keywords : config.keywords;

  // Determine priority bases from workflow, or use hardcoded defaults
  const mentionPriority = workflow?.feedPriority?.mentions ?? 100;
  const timelinePriority = workflow?.feedPriority?.timeline ?? 50;
  const discoveryPriority = workflow?.feedPriority?.discovery ?? 20;

  // Run all three sources in parallel — each can fail independently
  const [mentionsResult, timelineResult, discoveryResult] = await Promise.allSettled([
    fetchMentions(workflowName, mentionPriority),
    fetchTimeline(topics, keywords, workflowName, timelinePriority),
    fetchDiscovery(topics, keywords, workflowName, discoveryPriority),
  ]);

  // Collect results from fulfilled promises, silently drop rejected ones
  let mentions = mentionsResult.status === "fulfilled" ? mentionsResult.value : [];
  let timeline = timelineResult.status === "fulfilled" ? timelineResult.value : [];
  let discovery = discoveryResult.status === "fulfilled" ? discoveryResult.value : [];

  // Apply workflow-specific feed filters (minFollowers, requireHashtags, etc.)
  if (workflow) {
    mentions = applyWorkflowFilters(mentions, workflow);
    timeline = applyWorkflowFilters(timeline, workflow);
    discovery = applyWorkflowFilters(discovery, workflow);
  }

  // Merge all sources, then deduplicate discovery against mentions + timeline
  const seenIds = new Set([...mentions, ...timeline].map((i) => i.tweet.id));
  const dedupedDiscovery = discovery.filter((i) => !seenIds.has(i.tweet.id));
  const items = [...mentions, ...timeline, ...dedupedDiscovery];

  // Sort: unanswered tweets first, then by descending priority
  items.sort((a, b) => {
    if (a.alreadyEngaged !== b.alreadyEngaged) return a.alreadyEngaged ? 1 : -1;
    return b.priority - a.priority;
  });

  return {
    items,
    counts: {
      mentions: mentions.length,
      timeline: timeline.length,
      discovery: dedupedDiscovery.length,
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
