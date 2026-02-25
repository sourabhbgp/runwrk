/**
 * workflow.types.ts — Shared type definitions for the Twitter workflow system.
 *
 * Workflows are goal-driven engagement campaigns with isolated memory, strategy
 * prompts, feed filtering, and action biases. Each workflow runs independently
 * while sharing global safety state (blocked accounts, daily limits).
 */

// --- Template Types ---

/** Built-in workflow templates, plus "custom" for fully user-defined workflows */
export type WorkflowTemplate = "follower-growth" | "hashtag-niche" | "custom";

// --- Feed Configuration ---

/** Relative weight (0-100) for each feed source when scoring/ordering tweets */
export interface FeedPriority {
  mentions: number;
  timeline: number;
  discovery: number;
}

/** Mechanical filters applied to the feed before Claude sees tweets */
export interface FeedFilters {
  minFollowers?: number;
  requireHashtags?: string[];
  requireKeywords?: string[];
}

// --- Action Preferences ---

/** How heavily the agent should lean toward each action type */
export interface ActionBias {
  reply: "heavy" | "moderate" | "light";
  like: "heavy" | "moderate" | "light";
  retweet: "heavy" | "moderate" | "light";
  originalPost: "heavy" | "moderate" | "light";
  follow: "heavy" | "moderate" | "light";
}

// --- Workflow Limits ---

/** Per-session and per-day action caps for a workflow */
export interface WorkflowLimits {
  maxLikesPerSession: number;
  maxRepliesPerSession: number;
  maxFollowsPerSession: number;
  maxPostsPerDay: number;
  delayBetweenActions: [number, number];
}

// --- Workflow Config ---

/** Full configuration for a single workflow, persisted as workflow.json */
export interface WorkflowConfig {
  name: string;
  template: WorkflowTemplate;
  description: string;
  createdAt: string;
  strategyPrompt: string;
  topics: string[];
  keywords: string[];
  watchAccounts: string[];
  feedPriority: FeedPriority;
  feedFilters: FeedFilters;
  actionBias: ActionBias;
  limits: WorkflowLimits;
  /** Template-specific extras (e.g. hashtags for hashtag-niche) */
  params: Record<string, unknown>;
}

// --- Global Safety ---

/** Shared safety state across all workflows — blocked accounts + daily limits */
export interface GlobalSafetyState {
  blockedAccounts: string[];
  /** Post counts keyed by YYYY-MM-DD */
  dailyPostCounts: Record<string, number>;
}
