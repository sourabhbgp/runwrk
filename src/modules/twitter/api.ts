/**
 * api.ts — Rettiwt API wrapper for all Twitter operations.
 *
 * Wraps the rettiwt-api client with rate-limit-aware delay between actions.
 * All Twitter read/write operations go through this module.
 */

import { Rettiwt } from "rettiwt-api";
import { getDelay, type TwitterConfig } from "./config";
import { withTimeout } from "../../common";

// --- Client Singleton ---

/** Singleton rettiwt client — initialized once per session via createTwitterClient() */
let client: Rettiwt | null = null;

/** Initialize the rettiwt client with the user's API key (base64 cookie string) */
export function createTwitterClient(apiKey: string): Rettiwt {
  client = new Rettiwt({ apiKey });
  return client;
}

/** Get the initialized client, throwing if not yet created */
export function getClient(): Rettiwt {
  if (!client) throw new Error("Twitter client not initialized. Run createTwitterClient first.");
  return client;
}

// --- Timeout ---

/** Maximum time (ms) to wait for any single API read operation before aborting */
const API_TIMEOUT_MS = 15_000;

// --- Rate Limiting ---

/** Wait a randomized delay between actions to avoid rate limits.
 *  Delay range is configured in twitter-config.json (default 2-5 seconds). */
async function delay(config?: TwitterConfig): Promise<void> {
  const ms = getDelay(config);
  await new Promise((r) => setTimeout(r, ms));
}

// --- Write Operations ---

/** Post a new tweet, optionally as a reply or quote tweet.
 *  Returns the posted tweet's ID if available. */
export async function postTweet(
  text: string,
  options?: { replyTo?: string; quote?: string },
  config?: TwitterConfig
): Promise<string | undefined> {
  await delay(config);
  return await getClient().tweet.post({
    text,
    ...(options?.replyTo && { replyTo: options.replyTo }),
    ...(options?.quote && { quote: options.quote }),
  });
}

/** Like a tweet by its ID */
export async function likeTweet(tweetId: string, config?: TwitterConfig): Promise<void> {
  await delay(config);
  await getClient().tweet.like(tweetId);
}

/** Retweet a tweet by its ID */
export async function retweet(tweetId: string, config?: TwitterConfig): Promise<void> {
  await delay(config);
  await getClient().tweet.retweet(tweetId);
}

// --- Read Operations ---

/** Search tweets by query (keywords, hashtags, etc.). Returns up to `count` results. */
export async function searchTweets(
  query: string | Record<string, any>,
  count: number = 20
): Promise<any[]> {
  const result = await withTimeout(
    getClient().tweet.search(query as any, count),
    API_TIMEOUT_MS,
    "searchTweets"
  );
  return result?.list ?? [];
}

/** Get replies to a specific tweet */
export async function getTweetReplies(tweetId: string, count: number = 20): Promise<any[]> {
  const result = await withTimeout(
    getClient().tweet.replies(tweetId),
    API_TIMEOUT_MS,
    "getTweetReplies"
  );
  return result?.list ?? [];
}

/** Get full details for a single tweet by ID */
export async function getTweetDetails(tweetId: string): Promise<any> {
  return await withTimeout(getClient().tweet.details(tweetId), API_TIMEOUT_MS, "getTweetDetails");
}

/** Get user profile details by username */
export async function getUserDetails(username: string): Promise<any> {
  return await withTimeout(getClient().user.details(username), API_TIMEOUT_MS, "getUserDetails");
}

/** Get a user's recent tweets by their user ID */
export async function getUserTimeline(userId: string, count: number = 20): Promise<any[]> {
  const result = await withTimeout(
    getClient().user.timeline(userId, count),
    API_TIMEOUT_MS,
    "getUserTimeline"
  );
  return result?.list ?? [];
}

/** Get the authenticated user's followed/home feed */
export async function getFollowedFeed(): Promise<any[]> {
  const result = await withTimeout(getClient().user.followed(), API_TIMEOUT_MS, "getFollowedFeed");
  return result?.list ?? [];
}

/** Get the authenticated user's notifications (mentions, replies, etc.).
 *  Wraps the async generator in a timeout to prevent indefinite hangs
 *  when fewer than `count` notifications exist. */
export async function getNotifications(count: number = 20): Promise<any[]> {
  return await withTimeout(collectNotifications(count), API_TIMEOUT_MS, "getNotifications");
}

/** Consume the notifications async generator, collecting up to `count` items.
 *  Separated from getNotifications so the entire consumption can be timeout-wrapped. */
async function collectNotifications(count: number): Promise<any[]> {
  const notifications: any[] = [];
  const generator = getClient().user.notifications();
  for await (const notification of generator) {
    notifications.push(notification);
    if (notifications.length >= count) break;
  }
  return notifications;
}

/** Follow a user by their user ID */
export async function followUser(userId: string, config?: TwitterConfig): Promise<void> {
  await delay(config);
  await getClient().user.follow(userId);
}
