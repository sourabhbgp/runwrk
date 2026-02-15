import { searchTweets, getFollowedFeed, getNotifications, getTweetDetails } from "./api";
import { readConfig } from "./config";
import { hasRepliedTo, hasLiked } from "./memory";

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

export async function fetchFeed(): Promise<{
  items: FeedItem[];
  counts: { mentions: number; timeline: number; discovery: number };
}> {
  const config = readConfig();
  const items: FeedItem[] = [];

  // 1. Mentions / Notifications (highest priority)
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
    // Notifications may not be available — continue
  }

  // 2. Timeline (followed feed, filtered by topics/keywords)
  try {
    const timeline = await getFollowedFeed(30);
    const lowerTopics = [...config.topics, ...config.keywords].map((t) => t.toLowerCase());

    for (const raw of timeline) {
      const tweet = normalizeTweet(raw);
      if (!tweet) continue;
      const textLower = tweet.text.toLowerCase();
      const relevant = lowerTopics.length === 0 || lowerTopics.some((t) => textLower.includes(t));
      if (!relevant) continue;

      const engaged = hasRepliedTo(tweet.id) || hasLiked(tweet.id);
      items.push({
        type: "timeline",
        tweet,
        priority: 50 + Math.min(tweet.likes, 30),
        alreadyEngaged: engaged,
      });
    }
  } catch {
    // Timeline fetch failed — continue
  }

  // 3. Discovery (search by keywords/topics)
  try {
    const queries = [...config.keywords, ...config.topics].slice(0, 3);
    for (const q of queries) {
      const results = await searchTweets({ includeWords: [q] }, 10);
      for (const raw of results) {
        const tweet = normalizeTweet(raw);
        if (!tweet) continue;
        if (items.some((i) => i.tweet.id === tweet.id)) continue;

        const engaged = hasRepliedTo(tweet.id) || hasLiked(tweet.id);
        items.push({
          type: "discovery",
          tweet,
          priority: 20 + Math.min(tweet.likes / 10, 20),
          alreadyEngaged: engaged,
        });
      }
    }
  } catch {
    // Search failed — continue
  }

  // Sort: unanswered first, then by priority
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

export async function fetchThread(tweetId: string): Promise<FeedItem["thread"]> {
  try {
    const tweet = await getTweetDetails(tweetId);
    if (!tweet) return undefined;
    // If it's a reply, get the parent
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
