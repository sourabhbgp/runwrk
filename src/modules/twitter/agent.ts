/**
 * agent.ts — Claude integration for tweet analysis and reply generation.
 *
 * Builds a system prompt with voice/style guidelines, learned skip preferences,
 * blocked accounts, and recent history. Provides functions to analyze tweets
 * (suggest reply/like/skip), craft replies, and compose original tweets.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../auth";
import { readEnv } from "../../common";
import { readConfig } from "./config";
import { getRecentHistory, getSkipPatterns, getBlockedAccounts } from "./memory";
import type { FeedItem } from "./feed";

// --- Types ---

/** Possible actions Claude can suggest for a tweet */
export type SuggestedAction = "reply" | "like" | "quote" | "retweet" | "skip";

/** Claude's analysis of a tweet — action to take, reasoning, and optional draft text */
export type Analysis = {
  action: SuggestedAction;
  reason: string;
  draft?: string;
};

// --- Client Setup ---

/** Create an Anthropic client using the stored API key */
function getAnthropicClient(): Anthropic {
  const env = readEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key. Run `myteam setup` first.");
  return createAnthropicClient(key);
}

// --- System Prompt ---

/** Build the system prompt that guides Claude's engagement behavior.
 *  Incorporates config (topics), recent history, learned skip patterns,
 *  and blocked accounts so Claude improves over time. */
function buildSystemPrompt(): string {
  const config = readConfig();
  const history = getRecentHistory(8);
  const topics = config.topics.length > 0 ? config.topics.join(", ") : "general tech";
  const skipPatterns = getSkipPatterns(30);
  const blocked = getBlockedAccounts();

  // Build a "Learned Preferences" section only if there's data to show
  let learnedPreferences = "";
  if (skipPatterns || blocked.length > 0) {
    learnedPreferences = "\n## Learned Preferences\n";
    if (skipPatterns) {
      learnedPreferences += `The user tends to skip these types of tweets:\n${skipPatterns}\n\n`;
    }
    if (blocked.length > 0) {
      learnedPreferences += `Blocked accounts (never engage): ${blocked.map((a) => `@${a}`).join(", ")}\n`;
    }
    learnedPreferences += "\nSkip tweets matching these patterns proactively — don't wait for the user to skip them.";
  }

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
${learnedPreferences}

## Recent Engagement History
${history}

Avoid repeating similar replies. Keep engagement varied and authentic.`;
}

// --- Tweet Analysis ---

/** Send a tweet to Claude for analysis. Returns a suggested action (reply/like/skip/etc.)
 *  with reasoning and an optional draft reply. Includes thread context if available. */
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
    // If Claude's response isn't valid JSON, default to skip
    return { action: "skip", reason: "Could not parse response" };
  }
}

// --- Reply Crafting ---

/** Ask Claude to write a reply for a specific tweet, with optional user guidance.
 *  Returns the raw reply text (under 280 chars). */
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

// --- Original Tweet Composition ---

/** Ask Claude to compose an original tweet about a given topic (or default from config).
 *  Returns the raw tweet text (under 280 chars). */
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
