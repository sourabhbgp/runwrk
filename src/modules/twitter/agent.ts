import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../auth";
import { readEnv } from "../../common";
import { readConfig } from "./config";
import { getRecentHistory } from "./memory";
import type { FeedItem } from "./feed";

export type SuggestedAction = "reply" | "like" | "quote" | "retweet" | "skip";

export type Analysis = {
  action: SuggestedAction;
  reason: string;
  draft?: string;
};

function getAnthropicClient(): Anthropic {
  const env = readEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key. Run `myteam setup` first.");
  return createAnthropicClient(key);
}

function buildSystemPrompt(): string {
  const config = readConfig();
  const history = getRecentHistory(8);
  const topics = config.topics.length > 0 ? config.topics.join(", ") : "general tech";

  return `You are managing a Twitter account. Your job is to engage authentically with tweets.

## Voice & Style
- Write in a natural, conversational tone — like a real person, not a brand
- Be genuine and add value — share insights, ask thoughtful questions, or make relevant observations
- Keep replies concise (under 280 chars) and avoid hashtags unless highly relevant
- Match the energy of the conversation — casual for casual, technical for technical

## Topics of Interest
${topics}

## Safety Rules
- NEVER spam or self-promote aggressively
- NEVER be rude, dismissive, or argumentative
- NEVER engage with controversial political/social topics
- If a tweet is controversial, inflammatory, or you're unsure, recommend "skip"
- Prioritize quality over quantity — it's better to skip than post a generic reply

## Recent Engagement History
${history}

Avoid repeating similar replies. Keep engagement varied and authentic.`;
}

export async function analyzeTweet(item: FeedItem): Promise<Analysis> {
  const client = getAnthropicClient();
  const threadContext = item.thread
    ? item.thread.map((t) => `@${t.username}: ${t.text}`).join("\n")
    : "";

  const prompt = `Analyze this tweet and suggest an action.

${threadContext ? `## Thread Context\n${threadContext}\n\n` : ""}## Tweet
@${item.tweet.username}: ${item.tweet.text}
[${item.tweet.likes} likes, ${item.tweet.retweets} RTs, ${item.tweet.replies} replies]
Type: ${item.type}

Respond in this exact JSON format (no markdown, no code fences):
{"action": "reply|like|quote|retweet|skip", "reason": "brief explanation", "draft": "reply text if action is reply or quote, omit otherwise"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 300,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    return JSON.parse(text.trim());
  } catch {
    return { action: "skip", reason: "Could not parse response" };
  }
}

export async function craftReply(
  item: FeedItem,
  userGuidance?: string
): Promise<string> {
  const client = getAnthropicClient();
  const threadContext = item.thread
    ? item.thread.map((t) => `@${t.username}: ${t.text}`).join("\n")
    : "";

  const prompt = `Write a reply to this tweet.

${threadContext ? `## Thread Context\n${threadContext}\n\n` : ""}## Tweet
@${item.tweet.username}: ${item.tweet.text}

${userGuidance ? `## User Guidance\n${userGuidance}\n\n` : ""}Reply with ONLY the tweet text, nothing else. Keep it under 280 characters.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 200,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

export async function composeTweet(topic?: string): Promise<string> {
  const client = getAnthropicClient();
  const config = readConfig();
  const topicHint = topic ?? config.topics[0] ?? "something interesting in tech";

  const prompt = `Compose an original tweet about: ${topicHint}

Write ONLY the tweet text, nothing else. Keep it under 280 characters.
Make it insightful, engaging, and authentic — not generic or overly promotional.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 200,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}
