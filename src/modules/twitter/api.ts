import { Rettiwt } from "rettiwt-api";
import { getDelay, type TwitterConfig } from "./config";

let client: Rettiwt | null = null;

export function createTwitterClient(apiKey: string): Rettiwt {
  client = new Rettiwt({ apiKey });
  return client;
}

export function getClient(): Rettiwt {
  if (!client) throw new Error("Twitter client not initialized. Run createTwitterClient first.");
  return client;
}

async function delay(config?: TwitterConfig): Promise<void> {
  const ms = getDelay(config);
  await new Promise((r) => setTimeout(r, ms));
}

export async function postTweet(
  text: string,
  options?: { replyTo?: string; quote?: string },
  config?: TwitterConfig
): Promise<string | undefined> {
  await delay(config);
  const result = await getClient().tweet.post(text, {
    ...(options?.replyTo && { replyTo: options.replyTo }),
    ...(options?.quote && { quote: options.quote }),
  });
  return result?.id;
}

export async function likeTweet(tweetId: string, config?: TwitterConfig): Promise<void> {
  await delay(config);
  await getClient().tweet.like(tweetId);
}

export async function retweet(tweetId: string, config?: TwitterConfig): Promise<void> {
  await delay(config);
  await getClient().tweet.retweet(tweetId);
}

export async function searchTweets(
  query: string | Record<string, any>,
  count: number = 20
): Promise<any[]> {
  const result = await getClient().tweet.search(query as any, count);
  return result?.list ?? [];
}

export async function getTweetReplies(tweetId: string, count: number = 20): Promise<any[]> {
  const result = await getClient().tweet.replies(tweetId, count);
  return result?.list ?? [];
}

export async function getTweetDetails(tweetId: string): Promise<any> {
  return await getClient().tweet.details(tweetId);
}

export async function getUserDetails(username: string): Promise<any> {
  return await getClient().user.details(username);
}

export async function getUserTimeline(userId: string, count: number = 20): Promise<any[]> {
  const result = await getClient().user.timeline(userId, count);
  return result?.list ?? [];
}

export async function getFollowedFeed(count: number = 20): Promise<any[]> {
  const result = await getClient().user.followed(count);
  return result?.list ?? [];
}

export async function getNotifications(count: number = 20): Promise<any[]> {
  const result = await getClient().user.notifications(count);
  return result?.list ?? [];
}

export async function followUser(userId: string, config?: TwitterConfig): Promise<void> {
  await delay(config);
  await getClient().user.follow(userId);
}
