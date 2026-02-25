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

// --- Action Guidance ---

/** Map of action + bias level to concrete behavioral guidance for Claude.
 *  Replaces vague "heavy"/"moderate"/"light" labels with explicit instructions. */
const ACTION_GUIDANCE: Record<string, Record<string, string>> = {
  Reply: {
    heavy: "Reply to 60-70% of tweets you see. Your default should be to reply. Only skip if truly off-topic or controversial.",
    moderate: "Reply when you have a genuine insight or question to add. Aim for ~30-40% of tweets.",
    light: "Reply only when you have a uniquely valuable perspective. Be selective.",
  },
  Like: {
    heavy: "Like most tweets you find relevant — use likes generously to signal engagement.",
    moderate: "Like tweets you find genuinely interesting or to signal support without replying.",
    light: "Like sparingly — only for standout content you strongly endorse.",
  },
  Retweet: {
    heavy: "Retweet content that your audience would find valuable. Prefer quote tweets over plain retweets.",
    moderate: "Occasionally retweet high-quality content. Always prefer quote tweet over plain retweet.",
    light: "Rarely retweet. Always prefer quote tweet over plain retweet when you do.",
  },
  "Original post": {
    heavy: "Proactively compose original tweets sharing insights, observations, or questions.",
    moderate: "Post original tweets when inspiration strikes, but prioritize engagement over posting.",
    light: "Rarely post original tweets — focus engagement energy on replies and conversations.",
  },
  Follow: {
    heavy: "Follow accounts that engage back or share valuable content in your niche.",
    moderate: "Follow accounts you've had good interactions with or want to build a relationship with.",
    light: "Follow very selectively — only accounts you genuinely want to see in your timeline.",
  },
};

/** Build a single line of behavioral guidance for an action at a given bias level */
export function buildActionGuidance(action: string, level: string): string {
  const guidance = ACTION_GUIDANCE[action]?.[level];
  if (guidance) {
    return `- **${action}** (${level}): ${guidance}\n`;
  }
  return `- **${action}**: ${level}\n`;
}

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
  // Uses specific behavioral guidance per action per level instead of vague labels
  let actionPreferences = "";
  if (workflow?.actionBias) {
    const bias = workflow.actionBias;
    actionPreferences = `\n## Action Preferences\n`;
    actionPreferences += buildActionGuidance("Reply", bias.reply);
    actionPreferences += buildActionGuidance("Like", bias.like);
    actionPreferences += buildActionGuidance("Retweet", bias.retweet);
    actionPreferences += buildActionGuidance("Original post", bias.originalPost);
    actionPreferences += buildActionGuidance("Follow", bias.follow);

    // Add a Reply Strategy section when reply bias is heavy — gives Claude
    // concrete techniques for writing high-quality replies at volume
    if (bias.reply === "heavy") {
      actionPreferences += `\n## Reply Strategy\n`;
      actionPreferences += `- Ask thoughtful questions that invite a response back (replies back = 75x algorithm weight)\n`;
      actionPreferences += `- Share a related experience or complementary perspective\n`;
      actionPreferences += `- Add a specific insight the author might not have considered\n`;
      actionPreferences += `- Keep replies 1-3 sentences — concise beats clever, genuine beats perfect\n`;
      actionPreferences += `- NEVER start with "Great tweet!", "Love this!", or generic praise — add substance immediately\n`;
      actionPreferences += `- Always prefer quote tweet over plain retweet — quote tweets create content, retweets don't\n`;
    }
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
- Aim for quality AND quantity — a good genuine reply is always better than skipping. Only skip if clearly off-topic, controversial, or you truly have nothing to add${blockedSection}

## Memory
${memoryBlock}

Avoid repeating similar replies. Keep engagement varied and authentic.`;
}
