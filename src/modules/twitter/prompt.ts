/**
 * prompt.ts — System prompt builder for Claude's Twitter engagement behavior.
 *
 * Constructs a detailed system prompt incorporating voice/style guidelines,
 * topics of interest, safety rules, learned skip preferences, blocked accounts,
 * and recent engagement history so Claude improves over time.
 * When a WorkflowConfig is provided, injects strategy, action bias, and
 * workflow-specific topics into the prompt.
 */

import { readConfig } from "./config";
import { getRecentHistory, getSkipPatterns, getBlockedAccounts, getFeedback } from "./memory";
import type { WorkflowConfig } from "./workflow.types";

// --- System Prompt ---

/** Build the system prompt that guides Claude's engagement behavior.
 *  When a workflow is provided, adds strategy injection, action bias, and
 *  uses the workflow's topics. Falls back to global config when no workflow. */
export function buildSystemPrompt(workflow?: WorkflowConfig, workflowName?: string): string {
  // Use workflow topics if available, otherwise fall back to global config
  const config = readConfig();
  const topics = workflow && workflow.topics.length > 0
    ? workflow.topics.join(", ")
    : config.topics.length > 0
      ? config.topics.join(", ")
      : "general tech";

  const history = getRecentHistory(8, workflowName);
  const skipPatterns = getSkipPatterns(30, workflowName);
  const blocked = getBlockedAccounts();
  const feedback = getFeedback(workflowName);

  // Build a "Strategy" section from the workflow's strategy prompt
  let strategySection = "";
  if (workflow?.strategyPrompt) {
    strategySection = `\n## Strategy\n${workflow.strategyPrompt}\n`;
  }

  // Build an "Action Preferences" section from the workflow's action bias
  let actionPreferences = "";
  if (workflow?.actionBias) {
    const bias = workflow.actionBias;
    actionPreferences = `\n## Action Preferences\n`;
    actionPreferences += `- Replies: ${bias.reply}\n`;
    actionPreferences += `- Likes: ${bias.like}\n`;
    actionPreferences += `- Retweets: ${bias.retweet}\n`;
    actionPreferences += `- Original posts: ${bias.originalPost}\n`;
    actionPreferences += `- Follows: ${bias.follow}\n`;
    actionPreferences += `\n"Heavy" means strongly prefer this action. "Light" means use sparingly.`;
  }

  // Build a "User Directives" section only if there are feedback entries
  let userDirectives = "";
  if (feedback.length > 0) {
    userDirectives = "\n## User Directives\n";
    userDirectives += feedback.map((entry) => `- ${entry}`).join("\n");
    userDirectives += "\n\nFollow these directives strictly — they reflect the user's explicit preferences.";
  }

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
${strategySection}
## Voice & Style
- Write in a natural, conversational tone — like a real person, not a brand
- Be genuine and add value — share insights, ask thoughtful questions, or make relevant observations
- Keep replies concise (under 280 chars) and avoid hashtags unless highly relevant
- Match the energy of the conversation — casual for casual, technical for technical

## Topics of Interest
${topics}
${actionPreferences}
## Safety Rules
- NEVER spam or self-promote aggressively
- NEVER be rude, dismissive, or argumentative
- NEVER engage with controversial political/social topics
- If a tweet is controversial, inflammatory, or you're unsure, recommend "skip"
- Prioritize quality over quantity — it's better to skip than post a generic reply
${userDirectives}${learnedPreferences}

## Recent Engagement History
${history}

Avoid repeating similar replies. Keep engagement varied and authentic.`;
}
