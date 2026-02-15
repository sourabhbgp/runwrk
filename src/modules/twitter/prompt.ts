/**
 * prompt.ts — System prompt builder for Claude's Twitter engagement behavior.
 *
 * Constructs a detailed system prompt incorporating voice/style guidelines,
 * topics of interest, safety rules, learned skip preferences, blocked accounts,
 * and recent engagement history so Claude improves over time.
 */

import { readConfig } from "./config";
import { getRecentHistory, getSkipPatterns, getBlockedAccounts } from "./memory";

// --- System Prompt ---

/** Build the system prompt that guides Claude's engagement behavior.
 *  Incorporates config (topics), recent history, learned skip patterns,
 *  and blocked accounts so Claude improves over time. */
export function buildSystemPrompt(): string {
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
