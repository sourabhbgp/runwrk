/**
 * prompt.ts — System prompt builder for Claude's Twitter engagement behavior.
 *
 * Constructs a detailed system prompt incorporating voice/style guidelines,
 * topics of interest, safety rules, action bias, blocked accounts, and the
 * working memory block (facts, observations, relationships, directives, skip patterns).
 *
 * When a WorkflowConfig is provided, injects strategy, action bias, and
 * workflow-specific topics into the prompt.
 */

import { readConfig } from "./config";
import { getWorkingMemoryBlock, getBlockedAccounts } from "./memory";
import type { WorkflowConfig } from "./workflow.types";

// --- System Prompt ---

/** Build the system prompt that guides Claude's engagement behavior.
 *  When a workflow is provided, adds strategy injection, action bias, and
 *  uses the workflow's topics. Falls back to global config when no workflow.
 *  Injects the working memory block (facts, observations, relationships, etc.)
 *  instead of raw history/skip/feedback sections. */
export function buildSystemPrompt(workflow?: WorkflowConfig, workflowName?: string): string {
  // Use workflow topics if available, otherwise fall back to global config
  const config = readConfig();
  const topics = workflow && workflow.topics.length > 0
    ? workflow.topics.join(", ")
    : config.topics.length > 0
      ? config.topics.join(", ")
      : "general tech";

  // Build the working memory block — contains performance, facts, observations,
  // relationships, directives, and skip patterns in a single bounded section
  const memoryBlock = getWorkingMemoryBlock(workflowName);

  // Blocked accounts from global safety (always included regardless of workflow)
  const blocked = getBlockedAccounts();

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

  // Build blocked accounts section if any exist
  let blockedSection = "";
  if (blocked.length > 0) {
    blockedSection = `\nBlocked accounts (never engage): ${blocked.map((a) => `@${a}`).join(", ")}`;
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
- Prioritize quality over quantity — it's better to skip than post a generic reply${blockedSection}

## Memory
${memoryBlock}

Avoid repeating similar replies. Keep engagement varied and authentic.`;
}
