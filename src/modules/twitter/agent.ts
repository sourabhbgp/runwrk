/**
 * agent.ts — Claude integration for tweet analysis and reply generation.
 *
 * Provides functions to analyze tweets (suggest reply/like/skip), craft replies,
 * and compose original tweets. When a WorkflowConfig is provided, the strategy
 * prompt and action biases are injected into Claude's system prompt via prompt.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "../auth";
import { readEnv } from "../../common";
import { readConfig } from "./config";
import { buildSystemPrompt } from "./prompt";
import type { FeedItem } from "./feed";
import type { WorkflowConfig } from "./workflow.types";

// --- Types ---

/** Possible actions Claude can suggest for a tweet */
export type SuggestedAction = "reply" | "like" | "quote" | "retweet" | "skip";

/** Claude's analysis of a tweet — action to take, reasoning, and optional draft text */
export type Analysis = {
  action: SuggestedAction;
  reason: string;
  draft?: string;
};

// --- Helpers ---

/** Format a follower count into a human-readable compact form (e.g. 1,234 or 12.5K) */
export function formatFollowerCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

// --- Client Setup ---

/** Create an Anthropic client using the stored API key */
function getAnthropicClient(): Anthropic {
  const env = readEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key. Run `myteam setup` first.");
  return createAnthropicClient(key);
}

// --- Tweet Analysis ---

/** Send a tweet to Claude for analysis. Returns a suggested action (reply/like/skip/etc.)
 *  with reasoning and an optional draft reply. Includes thread context if available.
 *  When workflow is provided, injects strategy and action biases into the system prompt. */
export async function analyzeTweet(
  item: FeedItem,
  workflow?: WorkflowConfig,
  workflowName?: string,
): Promise<Analysis> {
  const client = getAnthropicClient();
  const threadContext = item.thread
    ? item.thread.map((t) => `@${t.username}: ${t.text}`).join("\n")
    : "";

  // Include follower count so Claude can make target-tier decisions
  // (e.g. 70% mid-tier, 20% peers, 10% large accounts per strategy)
  const followerLabel = formatFollowerCount(item.tweet.followers);

  const prompt = `Analyze this tweet and suggest an action.

${threadContext ? `## Thread Context\n${threadContext}\n\n` : ""}## Tweet
@${item.tweet.username} (${followerLabel} followers): ${item.tweet.text}
[${item.tweet.likes} likes, ${item.tweet.retweets} RTs, ${item.tweet.replies} replies]
Type: ${item.type}

If you draft a reply or quote, write it in your voice — sarcastic, funny, friendly, simple. No AI-speak.
Respond in this exact JSON format (no markdown, no code fences):
{"action": "reply|like|quote|retweet|skip", "reason": "brief explanation", "draft": "reply text if action is reply or quote, omit otherwise"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 300,
    system: buildSystemPrompt(workflow, workflowName),
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
  userGuidance?: string,
  workflow?: WorkflowConfig,
  workflowName?: string,
): Promise<string> {
  const client = getAnthropicClient();
  const threadContext = item.thread
    ? item.thread.map((t) => `@${t.username}: ${t.text}`).join("\n")
    : "";

  const prompt = `Write a reply to this tweet.

${threadContext ? `## Thread Context\n${threadContext}\n\n` : ""}## Tweet
@${item.tweet.username}: ${item.tweet.text}

${userGuidance ? `## User Guidance\n${userGuidance}\n\n` : ""}Reply with ONLY the tweet text, nothing else. Keep it under 280 characters.
Be witty and human — sarcasm, humor, warmth. No generic praise, no AI filler.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 200,
    system: buildSystemPrompt(workflow, workflowName),
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}

// --- Original Tweet Composition ---

/** Ask Claude to compose an original tweet about a given topic (or default from config).
 *  When a workflow is provided, uses the workflow's topics instead of global config. */
export async function composeTweet(
  topic?: string,
  workflow?: WorkflowConfig,
  workflowName?: string,
): Promise<string> {
  const client = getAnthropicClient();
  // Prefer workflow topics when available, fall back to global config
  const config = readConfig();
  const topicHint = topic
    ?? (workflow && workflow.topics.length > 0 ? workflow.topics[0] : null)
    ?? config.topics[0]
    ?? "something interesting in tech";

  const prompt = `Compose an original tweet about: ${topicHint}

Write ONLY the tweet text, nothing else. Keep it under 280 characters.
Make it funny, sharp, and human — a hot take, a sarcastic observation, or a clever question. No corporate tone, no AI vibes.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 200,
    system: buildSystemPrompt(workflow, workflowName),
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text.trim() : "";
}
