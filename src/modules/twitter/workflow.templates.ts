/**
 * workflow.templates.ts — Factory functions for pre-filled workflow configurations.
 *
 * Two built-in templates (follower-growth, hashtag-niche) plus a custom blank
 * template. Each factory produces a complete WorkflowConfig with sensible defaults
 * that can be overridden at creation time.
 */

import type { WorkflowConfig, WorkflowTemplate } from "./workflow.types";

// --- Default Limits (shared baseline for all templates) ---

const DEFAULT_LIMITS: WorkflowConfig["limits"] = {
  maxLikesPerSession: 12,
  maxRepliesPerSession: 17,
  maxFollowsPerSession: 3,
  maxPostsPerDay: 5,
  delayBetweenActions: [1500, 4000],
};

// --- Follower Growth Template ---

/** Create a workflow optimized for follower growth.
 *  Prioritizes high-follower accounts, discovery, and reply-heavy engagement. */
export function createFollowerGrowthWorkflow(
  name: string,
  overrides?: Partial<WorkflowConfig>,
): WorkflowConfig {
  return {
    name,
    template: "follower-growth",
    description: "Grow follower count by engaging with high-visibility accounts",
    createdAt: new Date().toISOString(),
    strategyPrompt:
      "Your primary goal is growing the account's follower count through high-volume, high-quality replies. " +
      "Replies carry 13.5-27x weight in Twitter's algorithm. If someone replies back, that's 75x weight. " +
      "Target 70% mid-tier accounts (5K-100K followers), 20% similar-sized peers, 10% large accounts (100K+). " +
      "Reply to 60-70% of tweets you see — your default is to engage, not skip. " +
      "Always prefer reply or quote tweet over like. " +
      "Be the account people remember — funny replies get follows, boring replies get ignored.",
    topics: [],
    keywords: [],
    watchAccounts: [],
    feedPriority: { mentions: 100, timeline: 50, discovery: 80 },
    feedFilters: { minFollowers: 0 },
    actionBias: {
      reply: "heavy",
      like: "moderate",
      retweet: "light",
      originalPost: "moderate",
      follow: "moderate",
    },
    limits: { ...DEFAULT_LIMITS },
    params: {},
    ...overrides,
  };
}

// --- Hashtag/Niche Campaign Template ---

/** Create a workflow focused on dominating specific hashtags/niches.
 *  Dynamically injects target hashtags into the strategy prompt. */
export function createHashtagNicheWorkflow(
  name: string,
  overrides?: Partial<WorkflowConfig>,
): WorkflowConfig {
  // Pull hashtags from params if provided, for dynamic prompt generation
  const hashtags = (overrides?.params?.hashtags as string[]) ?? [];
  const hashtagStr = hashtags.length > 0 ? hashtags.map((h) => `#${h}`).join(", ") : "#<your-hashtags>";

  return {
    name,
    template: "hashtag-niche",
    description: `Become a recognized voice in ${hashtagStr}`,
    createdAt: new Date().toISOString(),
    strategyPrompt:
      `Your goal is to become a recognized voice in ${hashtagStr}. ` +
      "Every reply should demonstrate deep expertise — but make it fun, not lecture-y. " +
      "Post original insights using target hashtags. " +
      "Engage with others in the niche like you're the funniest person in the group chat.",
    topics: [],
    keywords: [],
    watchAccounts: [],
    feedPriority: { mentions: 60, timeline: 30, discovery: 90 },
    feedFilters: { requireHashtags: hashtags },
    actionBias: {
      reply: "heavy",
      like: "light",
      retweet: "moderate",
      originalPost: "heavy",
      follow: "light",
    },
    limits: { ...DEFAULT_LIMITS },
    params: { hashtags },
    ...overrides,
  };
}

// --- Custom (Blank) Template ---

/** Create a blank custom workflow with neutral defaults for full user control */
export function createCustomWorkflow(
  name: string,
  overrides?: Partial<WorkflowConfig>,
): WorkflowConfig {
  return {
    name,
    template: "custom",
    description: "",
    createdAt: new Date().toISOString(),
    strategyPrompt: "",
    topics: [],
    keywords: [],
    watchAccounts: [],
    feedPriority: { mentions: 100, timeline: 50, discovery: 20 },
    feedFilters: {},
    actionBias: {
      reply: "moderate",
      like: "moderate",
      retweet: "moderate",
      originalPost: "moderate",
      follow: "moderate",
    },
    limits: { ...DEFAULT_LIMITS },
    params: {},
    ...overrides,
  };
}

// --- Template Registry ---

/** Template metadata for interactive selection */
interface TemplateEntry {
  label: string;
  description: string;
  factory: (name: string, overrides?: Partial<WorkflowConfig>) => WorkflowConfig;
}

/** Map of template names to their metadata and factory functions */
export const TEMPLATES: Record<WorkflowTemplate, TemplateEntry> = {
  "follower-growth": {
    label: "Follower Growth",
    description: "Grow followers by engaging with high-visibility accounts",
    factory: createFollowerGrowthWorkflow,
  },
  "hashtag-niche": {
    label: "Hashtag/Niche Campaign",
    description: "Dominate specific hashtags and become a recognized niche voice",
    factory: createHashtagNicheWorkflow,
  },
  custom: {
    label: "Custom",
    description: "Blank slate — configure everything yourself",
    factory: createCustomWorkflow,
  },
};
