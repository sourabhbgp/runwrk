/**
 * memory.actions.ts — Raw engagement action log (the "source of truth" layer).
 *
 * Every engagement action (reply, like, skip, etc.) is appended here as an atomic
 * entry. This is the lowest layer of the memory system — it records what happened
 * without interpretation. Higher layers (facts, observations) are derived from
 * this data during daily consolidation.
 *
 * Storage: `.myteam/workflows/<name>/actions.json`
 * Read pattern: read-modify-write (single-threaded CLI, no concurrency concerns)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getLogger } from "../../common";
import { workflowActionsPath } from "./workflow";
import type { Action, ActionStore, ActionType, DayStats } from "./memory.types";

// --- Defaults ---

/** Empty action store — used when no file exists yet */
const EMPTY_STORE: ActionStore = {
  actions: [],
  directives: [],
  lastConsolidation: null,
};

// --- Persistence Helpers ---

/** Ensure the parent directory exists before writing */
function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Resolve the actions.json path for a workflow */
function getPath(workflowName: string): string {
  return workflowActionsPath(workflowName);
}

/** Load the action store from disk, falling back to empty defaults */
export function readActionStore(workflowName: string): ActionStore {
  const path = getPath(workflowName);
  if (!existsSync(path)) return { ...EMPTY_STORE, actions: [], directives: [] };
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...EMPTY_STORE, ...JSON.parse(raw) };
  } catch (e: unknown) {
    getLogger().child({ component: "twitter" }).warn({ err: e, path }, "Action store JSON parse failed, resetting");
    return { ...EMPTY_STORE, actions: [], directives: [] };
  }
}

/** Write the full action store to disk as pretty-printed JSON */
export function saveActionStore(store: ActionStore, workflowName: string): void {
  const path = getPath(workflowName);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

// --- Action Logging ---

/** Append a single action to the log. This is the unified entry point for all action types. */
export function logAction(action: Action, workflowName: string): void {
  const store = readActionStore(workflowName);
  store.actions.push(action);
  saveActionStore(store, workflowName);
}

// --- Duplicate Checks ---

/** Check if we've already performed a specific action on a tweet (prevents double-engagement) */
export function hasEngaged(type: ActionType, tweetId: string, workflowName: string): boolean {
  const store = readActionStore(workflowName);
  return store.actions.some((a) => a.type === type && a.tweetId === tweetId);
}

// --- Consolidation Helpers ---

/** Return actions that haven't been processed by consolidation yet.
 *  Optionally filters to only include actions older than N hours (gives time for engagement to materialize). */
export function getUnconsolidated(workflowName: string, olderThanHours: number = 0): Action[] {
  const store = readActionStore(workflowName);
  const cutoff = olderThanHours > 0
    ? new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString()
    : new Date().toISOString();

  return store.actions.filter((a) => !a.consolidated && a.date <= cutoff);
}

/** Mark all actions before a given date as consolidated (processed by the extraction pipeline) */
export function markConsolidated(beforeDate: string, workflowName: string): void {
  const store = readActionStore(workflowName);
  for (const action of store.actions) {
    if (!action.consolidated && action.date <= beforeDate) {
      action.consolidated = true;
    }
  }
  // Update the last consolidation timestamp
  store.lastConsolidation = new Date().toISOString();
  saveActionStore(store, workflowName);
}

// --- Stats Queries ---

/** Return today's date as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute per-day action counts from the raw action log (for rate limiting + stats display) */
export function getDailyStats(workflowName: string): Record<string, DayStats> {
  const store = readActionStore(workflowName);
  const stats: Record<string, DayStats> = {};

  for (const action of store.actions) {
    const day = action.date.slice(0, 10);
    if (!stats[day]) {
      stats[day] = { replies: 0, likes: 0, posts: 0, follows: 0, retweets: 0 };
    }
    // Map action types to stat fields
    switch (action.type) {
      case "reply": stats[day].replies++; break;
      case "like": stats[day].likes++; break;
      case "post": stats[day].posts++; break;
      case "follow": stats[day].follows++; break;
      case "retweet": stats[day].retweets++; break;
      // Skips are not counted in DayStats (they're non-actions)
    }
  }
  return stats;
}

/** Get the count of a specific action type for today */
export function getTodayCount(type: keyof DayStats, workflowName: string): number {
  const stats = getDailyStats(workflowName);
  const todayStats = stats[today()];
  return todayStats?.[type] ?? 0;
}

// --- Skip Pattern Analysis ---

/** Tally the top N skip reasons from recent skip actions, formatted as a ranked list.
 *  Returns empty string if no skip data available. */
export function getSkipPatterns(n: number = 30, workflowName: string): string {
  const store = readActionStore(workflowName);
  const skips = store.actions
    .filter((a) => a.type === "skip" && a.reason)
    .slice(-n);

  if (skips.length === 0) return "";

  // Tally reasons by frequency
  const reasonCounts: Record<string, number> = {};
  for (const skip of skips) {
    const key = (skip.reason ?? "").toLowerCase().trim();
    if (key) reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

  // Return top 8 sorted by frequency
  return Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => `- ${reason} (${count}x)`)
    .join("\n");
}

// --- Recent Reply History ---

/** Format the last N replies as readable text for context in the system prompt */
export function getRecentReplies(n: number = 10, workflowName: string): string {
  const store = readActionStore(workflowName);
  const replies = store.actions
    .filter((a) => a.type === "reply" && a.username && a.text)
    .slice(-n);

  if (replies.length === 0) return "No recent engagement history.";

  return replies
    .map((r) => `- Replied to @${r.username}: "${(r.text ?? "").slice(0, 80)}..."`)
    .join("\n");
}
