/**
 * config.ts — Read/write Twitter engagement configuration from .myteam/twitter-config.json
 *
 * Stores topics, keywords, watch accounts, and rate limits.
 * Falls back to sensible defaults if no config file exists.
 * Also provides a helper to merge workflow-specific limits with global defaults.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { WorkflowConfig } from "./workflow.types";

const CONFIG_PATH = join(process.cwd(), ".myteam", "twitter-config.json");

// --- Types ---

/** Full Twitter engagement configuration */
export type TwitterConfig = {
  topics: string[];
  keywords: string[];
  watchAccounts: string[];
  limits: {
    maxLikesPerSession: number;
    maxRepliesPerSession: number;
    maxPostsPerDay: number;
    /** Min/max milliseconds to wait between API actions (randomized) */
    delayBetweenActions: [number, number];
  };
};

/** Sensible defaults — used when no config file exists */
const DEFAULT_CONFIG: TwitterConfig = {
  topics: [],
  keywords: [],
  watchAccounts: [],
  limits: {
    maxLikesPerSession: 10,
    maxRepliesPerSession: 5,
    maxPostsPerDay: 3,
    delayBetweenActions: [2000, 5000],
  },
};

// --- Persistence ---

/** Ensure the .myteam/ directory exists before writing */
function ensureDir() {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load config from disk, merging with defaults for any missing fields */
export function readConfig(): TwitterConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save the full config to disk as pretty-printed JSON */
export function writeConfig(config: TwitterConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/** Get a random delay (in ms) within the configured range for rate limiting */
export function getDelay(config?: TwitterConfig): number {
  const [min, max] = (config ?? readConfig()).limits.delayBetweenActions;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Merge workflow limits with global config defaults.
 *  When a workflow is provided, its limits take precedence. */
export function mergedLimits(workflow?: WorkflowConfig): TwitterConfig["limits"] {
  const globalLimits = readConfig().limits;
  if (!workflow) return globalLimits;
  return {
    ...globalLimits,
    ...workflow.limits,
  };
}
