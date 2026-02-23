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
  maxLikesPerSession: 10,
  maxRepliesPerSession: 5,
  maxPostsPerDay: 3,
  delayBetweenActions: [2000, 5000],
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
      "Your primary goal is growing the account's follower count. " +
      "Prioritize replying to tweets from high-follower accounts. " +
      "Write insightful replies that make people curious about you. " +
      "Bias toward replies over likes — replies create visibility, likes don't.",
    topics: [],
    keywords: [],
    watchAccounts: [],
    feedPriority: { mentions: 100, timeline: 40, discovery: 70 },
    feedFilters: { minFollowers: 1000 },
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
      "Every reply should demonstrate deep expertise. " +
      "Post original insights using target hashtags. " +
      "Engage authentically with others in the niche to build community presence.",
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
