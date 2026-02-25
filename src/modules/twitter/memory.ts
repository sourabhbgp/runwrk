/**
 * memory.ts — Public API facade for the tiered memory system.
 *
 * This file preserves every export signature that callers (session.ts, auto.ts,
 * feed.ts, stats.ts, prompt.ts) already depend on, but delegates internally to
 * the new storage modules. This means NO caller files need to change their imports.
 *
 * Architecture:
 *   memory.ts (this file — public API, thin wrappers)
 *     ├── memory.actions.ts    (raw action CRUD)
 *     ├── memory.facts.ts      (atomic knowledge store)
 *     ├── memory.observations.ts (session summaries)
 *     ├── memory.relationships.ts (account CRM)
 *     ├── memory.working.ts    (prompt context assembler)
 *     └── memory.consolidate.ts (daily LLM extraction)
 *
 * New code should import directly from the specific module when possible.
 * This facade exists for backward compatibility with existing callers.
 */

import {
  logAction, hasEngaged, getDailyStats, getSkipPatterns as actionsGetSkipPatterns,
  getRecentReplies, readActionStore, saveActionStore, getTodayCount,
} from "./memory.actions";
import { recordInteraction } from "./memory.relationships";
import { buildWorkingMemory, formatWorkingMemoryForPrompt } from "./memory.working";
import { globalBlockAccount, isGloballyBlocked, readGlobalSafety } from "./workflow";
import type { DayStats } from "./memory.types";

// --- Re-export DayStats for stats.ts and any other consumer ---

export type { DayStats };

// --- Legacy TwitterMemory type (used by stats.ts) ---

/** Legacy memory shape — reconstructed from actions.json for backward compatibility */
export type TwitterMemory = {
  repliedTo: Array<{ tweetId: string; userId: string; username: string; date: string; ourReply?: string }>;
  liked: string[];
  retweeted: string[];
  posted: Array<{ tweetId: string; userId: string; username: string; date: string; ourReply?: string }>;
  followed: string[];
  dailyStats: Record<string, DayStats>;
  skipped: Array<{ username: string; snippet: string; reason: string; date: string }>;
  blockedAccounts: string[];
  feedback: string[];
};

// --- Backward-Compatible Persistence ---

/** Reconstruct the old TwitterMemory shape from the new actions.json store.
 *  Used by stats.ts and any code that still expects the legacy format. */
export function readMemory(workflowName?: string): TwitterMemory {
  if (!workflowName) {
    // No workflow — return empty memory (legacy path no longer supported)
    return emptyMemory();
  }

  const store = readActionStore(workflowName);
  const actions = store.actions;

  // Reconstruct each array from the action log
  const repliedTo = actions
    .filter((a) => a.type === "reply")
    .map((a) => ({
      tweetId: a.tweetId ?? "",
      userId: a.userId ?? "",
      username: a.username ?? "",
      date: a.date,
      ourReply: a.text,
    }));

  const liked = actions
    .filter((a) => a.type === "like")
    .map((a) => a.tweetId ?? "");

  const retweeted = actions
    .filter((a) => a.type === "retweet")
    .map((a) => a.tweetId ?? "");

  const posted = actions
    .filter((a) => a.type === "post")
    .map((a) => ({
      tweetId: a.tweetId ?? "",
      userId: "",
      username: "",
      date: a.date,
      ourReply: a.text,
    }));

  const followed = actions
    .filter((a) => a.type === "follow")
    .map((a) => a.userId ?? "");

  const skipped = actions
    .filter((a) => a.type === "skip")
    .map((a) => ({
      username: a.username ?? "",
      snippet: (a.text ?? "").slice(0, 120),
      reason: a.reason ?? "",
      date: a.date,
    }));

  return {
    repliedTo,
    liked,
    retweeted,
    posted,
    followed,
    dailyStats: getDailyStats(workflowName),
    skipped,
    blockedAccounts: readGlobalSafety().blockedAccounts,
    feedback: store.directives,
  };
}

/** Return an empty memory object (for when no workflow is specified) */
function emptyMemory(): TwitterMemory {
  return {
    repliedTo: [],
    liked: [],
    retweeted: [],
    posted: [],
    followed: [],
    dailyStats: {},
    skipped: [],
    blockedAccounts: readGlobalSafety().blockedAccounts,
    feedback: [],
  };
}

/** Write a TwitterMemory object back to storage (backward-compat for tests).
 *  Converts the legacy format into an ActionStore and saves to actions.json. */
export function saveMemory(mem: TwitterMemory, workflowName?: string): void {
  if (!workflowName) return;

  // Convert the legacy format into actions
  const actions: import("./memory.types").Action[] = [];

  for (const entry of mem.repliedTo) {
    actions.push({
      type: "reply", tweetId: entry.tweetId, userId: entry.userId,
      username: entry.username, text: entry.ourReply, date: entry.date, consolidated: false,
    });
  }
  for (const tweetId of mem.liked) {
    actions.push({ type: "like", tweetId, date: new Date().toISOString(), consolidated: false });
  }
  for (const tweetId of mem.retweeted) {
    actions.push({ type: "retweet", tweetId, date: new Date().toISOString(), consolidated: false });
  }
  for (const entry of mem.posted) {
    actions.push({
      type: "post", tweetId: entry.tweetId, text: entry.ourReply,
      date: entry.date, consolidated: false,
    });
  }
  for (const userId of mem.followed) {
    actions.push({ type: "follow", userId, date: new Date().toISOString(), consolidated: false });
  }
  for (const entry of mem.skipped) {
    actions.push({
      type: "skip", username: entry.username, text: entry.snippet,
      reason: entry.reason, date: entry.date, consolidated: false,
    });
  }

  const store: import("./memory.types").ActionStore = {
    actions,
    directives: mem.feedback,
    lastConsolidation: null,
  };

  saveActionStore(store, workflowName);
}

// --- Action Logging (delegates to memory.actions + memory.relationships) ---

/** Record that we replied to a specific tweet */
export function logReply(
  tweetId: string, userId: string, username: string, ourReply: string,
  workflowName?: string,
): void {
  if (!workflowName) return;
  logAction({
    type: "reply",
    tweetId,
    userId,
    username,
    text: ourReply,
    date: new Date().toISOString(),
    consolidated: false,
  }, workflowName);
  // Also track the relationship
  recordInteraction(username, "our-reply", workflowName);
}

/** Record that we liked a tweet */
export function logLike(tweetId: string, workflowName?: string): void {
  if (!workflowName) return;
  logAction({
    type: "like",
    tweetId,
    date: new Date().toISOString(),
    consolidated: false,
  }, workflowName);
}

/** Record that we retweeted a tweet */
export function logRetweet(tweetId: string, workflowName?: string): void {
  if (!workflowName) return;
  logAction({
    type: "retweet",
    tweetId,
    date: new Date().toISOString(),
    consolidated: false,
  }, workflowName);
}

/** Record an original post we published */
export function logPost(tweetId: string, content: string, workflowName?: string): void {
  if (!workflowName) return;
  logAction({
    type: "post",
    tweetId,
    text: content,
    date: new Date().toISOString(),
    consolidated: false,
  }, workflowName);
}

/** Record that we followed a user */
export function logFollow(userId: string, workflowName?: string): void {
  if (!workflowName) return;
  logAction({
    type: "follow",
    userId,
    date: new Date().toISOString(),
    consolidated: false,
  }, workflowName);
}

// --- Skip Tracking ---

/** Record a skipped tweet with the reason, for learning user preferences */
export function logSkip(username: string, snippet: string, reason: string, workflowName?: string): void {
  if (!workflowName) return;
  logAction({
    type: "skip",
    username,
    text: snippet.slice(0, 120),
    reason,
    date: new Date().toISOString(),
    consolidated: false,
  }, workflowName);
}

// --- Duplicate Checks ---

/** Check if we've already replied to a given tweet */
export function hasRepliedTo(tweetId: string, workflowName?: string): boolean {
  if (!workflowName) return false;
  return hasEngaged("reply", tweetId, workflowName);
}

/** Check if we've already liked a given tweet */
export function hasLiked(tweetId: string, workflowName?: string): boolean {
  if (!workflowName) return false;
  return hasEngaged("like", tweetId, workflowName);
}

/** Check if we've already followed a given user (by userId) */
export function hasFollowed(userId: string, workflowName?: string): boolean {
  if (!workflowName) return false;
  const store = readActionStore(workflowName);
  return store.actions.some((a) => a.type === "follow" && a.userId === userId);
}

// --- Stats Queries ---

/** Get the count of a specific action type for today */
export function getDailyCount(type: keyof DayStats, workflowName?: string): number {
  if (!workflowName) return 0;
  return getTodayCount(type, workflowName);
}

/** Format recent reply history as a readable string for Claude's system prompt */
export function getRecentHistory(n: number = 10, workflowName?: string): string {
  if (!workflowName) return "No recent engagement history.";
  return getRecentReplies(n, workflowName);
}

// --- Skip Pattern Analysis ---

/** Summarize recent skip reasons into a ranked list for Claude's system prompt */
export function getSkipPatterns(n: number = 30, workflowName?: string): string {
  if (!workflowName) return "";
  return actionsGetSkipPatterns(n, workflowName);
}

// --- Block Management (delegates to global safety — unchanged) ---

/** Permanently block an account — delegates to global safety state */
export function blockAccount(username: string): void {
  globalBlockAccount(username);
}

/** Check if a username is on the permanent blocklist (global) */
export function isBlocked(username: string): boolean {
  return isGloballyBlocked(username);
}

/** Return the full list of blocked account usernames (from global safety) */
export function getBlockedAccounts(): string[] {
  return readGlobalSafety().blockedAccounts;
}

// --- User Feedback / Directives (stored in ActionStore.directives) ---

/** Add a timestamped feedback directive that persists across sessions */
export function addFeedback(text: string, workflowName?: string): void {
  if (!workflowName) return;
  const store = readActionStore(workflowName);
  const entry = `[${new Date().toISOString().slice(0, 10)}] ${text}`;
  store.directives.push(entry);
  saveActionStore(store, workflowName);
}

/** Return all stored feedback directives */
export function getFeedback(workflowName?: string): string[] {
  if (!workflowName) return [];
  return readActionStore(workflowName).directives;
}

/** Remove a specific feedback entry by index */
export function removeFeedback(index: number, workflowName?: string): void {
  if (!workflowName) return;
  const store = readActionStore(workflowName);
  if (index >= 0 && index < store.directives.length) {
    store.directives.splice(index, 1);
    saveActionStore(store, workflowName);
  }
}

// --- New: Working Memory (for prompt.ts) ---

/** Build and format the working memory block for injection into the system prompt.
 *  Returns a markdown string with performance, facts, observations, relationships,
 *  directives, and skip patterns — capped to ~2-3K tokens. */
export function getWorkingMemoryBlock(workflowName?: string): string {
  if (!workflowName) return "No memory data yet.";
  const wm = buildWorkingMemory(workflowName);
  return formatWorkingMemoryForPrompt(wm);
}
