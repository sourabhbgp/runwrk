/**
 * workflow.migrate.ts — Multi-stage migration for the Twitter engagement module.
 *
 * Stage 1 (legacy → workflow): Migrates the old flat `.runwrk/twitter-memory.json`
 * into the per-workflow structure at `.runwrk/workflows/default/`.
 *
 * Stage 2 (memory.json → actions.json): Converts the old memory.json format
 * (arrays of repliedTo, liked, skipped, etc.) into the new tiered memory system
 * (actions.json + empty facts/observations/relationships stores).
 *
 * Old files are renamed to .backup — never deleted.
 * Called at the top of any workflow-aware command via ensureMigrated().
 */

import { readFileSync, existsSync, renameSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import {
  writeWorkflowConfig, writeGlobalSafety, workflowDir, workflowMemoryPath,
  workflowActionsPath, workflowFactsPath, workflowObservationsPath, workflowRelationshipsPath,
} from "./workflow";
import { createCustomWorkflow } from "./workflow.templates";
import { writeFileSync } from "fs";
import { info, dim } from "../../common";
import type { Action, ActionStore, FactStore, ObservationStore, RelationshipStore } from "./memory.types";

// Lazy path getters for testability with process.chdir
function getBaseDir(): string { return join(process.cwd(), ".runwrk"); }
function getWorkflowsDir(): string { return join(getBaseDir(), "workflows"); }
function getOldMemoryPath(): string { return join(getBaseDir(), "twitter-memory.json"); }
function getOldConfigPath(): string { return join(getBaseDir(), "twitter-config.json"); }

// --- Stage 1: Legacy flat → workflow directories ---

/** Migrate the old flat structure to workflow directories.
 *  Creates a "default" workflow from the old config and memory. */
function migrateLegacyToWorkflows(): void {
  const workflowsDir = getWorkflowsDir();
  const oldMemoryPath = getOldMemoryPath();
  const oldConfigPath = getOldConfigPath();

  // Already migrated — workflows directory exists
  if (existsSync(workflowsDir)) return;

  // No old memory file — fresh install, just create the empty workflows dir
  if (!existsSync(oldMemoryPath)) {
    mkdirSync(workflowsDir, { recursive: true });
    return;
  }

  info(`Migrating to workflow system...`);

  // --- Read old data ---
  let oldMemory: Record<string, unknown> = {};
  try {
    oldMemory = JSON.parse(readFileSync(oldMemoryPath, "utf-8"));
  } catch {
    // Corrupt file — proceed with empty data
  }

  let oldConfig: Record<string, unknown> = {};
  try {
    if (existsSync(oldConfigPath)) {
      oldConfig = JSON.parse(readFileSync(oldConfigPath, "utf-8"));
    }
  } catch {
    // Corrupt file — proceed with empty data
  }

  // --- Extract blocked accounts → global safety state ---
  const blockedAccounts = Array.isArray(oldMemory.blockedAccounts)
    ? (oldMemory.blockedAccounts as string[])
    : [];

  writeGlobalSafety({
    blockedAccounts,
    dailyPostCounts: {},
  });

  // --- Remove blockedAccounts from memory before writing to workflow ---
  const workflowMemory = { ...oldMemory };
  delete workflowMemory.blockedAccounts;

  // --- Create default workflow directory and memory ---
  const defaultDir = workflowDir("default");
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(workflowMemoryPath("default"), JSON.stringify(workflowMemory, null, 2) + "\n");

  // --- Build a default workflow config from old config values ---
  const topics = Array.isArray(oldConfig.topics) ? (oldConfig.topics as string[]) : [];
  const keywords = Array.isArray(oldConfig.keywords) ? (oldConfig.keywords as string[]) : [];
  const watchAccounts = Array.isArray(oldConfig.watchAccounts) ? (oldConfig.watchAccounts as string[]) : [];

  // Extract limits if present in old config
  const oldLimits = typeof oldConfig.limits === "object" && oldConfig.limits !== null
    ? (oldConfig.limits as Record<string, unknown>)
    : {};

  const defaultWorkflow = createCustomWorkflow("default", {
    description: "Auto-migrated from legacy flat config",
    topics,
    keywords,
    watchAccounts,
    limits: {
      maxLikesPerSession: typeof oldLimits.maxLikesPerSession === "number" ? oldLimits.maxLikesPerSession : 10,
      maxRepliesPerSession: typeof oldLimits.maxRepliesPerSession === "number" ? oldLimits.maxRepliesPerSession : 5,
      maxFollowsPerSession: typeof oldLimits.maxFollowsPerSession === "number" ? oldLimits.maxFollowsPerSession : 3,
      maxPostsPerDay: typeof oldLimits.maxPostsPerDay === "number" ? oldLimits.maxPostsPerDay : 3,
      delayBetweenActions: Array.isArray(oldLimits.delayBetweenActions)
        ? (oldLimits.delayBetweenActions as [number, number])
        : [2000, 5000],
    },
  });

  writeWorkflowConfig("default", defaultWorkflow);

  // --- Backup old files (preserve, never delete) ---
  try {
    renameSync(oldMemoryPath, oldMemoryPath + ".backup");
  } catch {
    // Ignore rename failures (permissions, etc.)
  }

  info(`Migration complete. Your data is now in ${dim("workflows/default/")}`);
  info(`Old files renamed to .backup`);
}

// --- Stage 2: memory.json → actions.json (tiered memory migration) ---

/** Convert a workflow's memory.json into the new tiered memory format.
 *  Translates repliedTo/liked/skipped/etc. arrays into Action entries in actions.json,
 *  and initializes empty facts, observations, and relationships stores.
 *  All migrated actions are marked consolidated: true to prevent re-consolidation. */
function migrateMemoryToActions(workflowName: string): void {
  const actionsPath = workflowActionsPath(workflowName);
  const memoryPath = workflowMemoryPath(workflowName);

  // Already migrated — actions.json exists
  if (existsSync(actionsPath)) return;

  // No memory.json to migrate — create empty stores
  if (!existsSync(memoryPath)) {
    initializeEmptyStores(workflowName);
    return;
  }

  // Read old memory data
  let oldMemory: Record<string, unknown> = {};
  try {
    oldMemory = JSON.parse(readFileSync(memoryPath, "utf-8"));
  } catch {
    // Corrupt file — create empty stores
    initializeEmptyStores(workflowName);
    return;
  }

  info(`Migrating memory for workflow "${workflowName}"...`);

  const actions: Action[] = [];

  // --- Convert repliedTo[] → reply actions ---
  const repliedTo = Array.isArray(oldMemory.repliedTo) ? oldMemory.repliedTo as Array<Record<string, unknown>> : [];
  for (const entry of repliedTo) {
    actions.push({
      type: "reply",
      tweetId: String(entry.tweetId ?? ""),
      userId: String(entry.userId ?? ""),
      username: String(entry.username ?? ""),
      text: entry.ourReply ? String(entry.ourReply) : undefined,
      date: String(entry.date ?? new Date().toISOString()),
      consolidated: true,
    });
  }

  // --- Convert liked[] → like actions ---
  const liked = Array.isArray(oldMemory.liked) ? oldMemory.liked as string[] : [];
  for (const tweetId of liked) {
    actions.push({
      type: "like",
      tweetId: String(tweetId),
      date: new Date().toISOString(), // No date in old format, use now
      consolidated: true,
    });
  }

  // --- Convert retweeted[] → retweet actions ---
  const retweeted = Array.isArray(oldMemory.retweeted) ? oldMemory.retweeted as string[] : [];
  for (const tweetId of retweeted) {
    actions.push({
      type: "retweet",
      tweetId: String(tweetId),
      date: new Date().toISOString(),
      consolidated: true,
    });
  }

  // --- Convert posted[] → post actions ---
  const posted = Array.isArray(oldMemory.posted) ? oldMemory.posted as Array<Record<string, unknown>> : [];
  for (const entry of posted) {
    actions.push({
      type: "post",
      tweetId: String(entry.tweetId ?? ""),
      text: entry.ourReply ? String(entry.ourReply) : undefined,
      date: String(entry.date ?? new Date().toISOString()),
      consolidated: true,
    });
  }

  // --- Convert followed[] → follow actions ---
  const followed = Array.isArray(oldMemory.followed) ? oldMemory.followed as string[] : [];
  for (const userId of followed) {
    actions.push({
      type: "follow",
      userId: String(userId),
      date: new Date().toISOString(),
      consolidated: true,
    });
  }

  // --- Convert skipped[] → skip actions ---
  const skipped = Array.isArray(oldMemory.skipped) ? oldMemory.skipped as Array<Record<string, unknown>> : [];
  for (const entry of skipped) {
    actions.push({
      type: "skip",
      username: String(entry.username ?? ""),
      text: entry.snippet ? String(entry.snippet).slice(0, 120) : undefined,
      reason: entry.reason ? String(entry.reason) : undefined,
      date: String(entry.date ?? new Date().toISOString()),
      consolidated: true,
    });
  }

  // --- Extract feedback → directives ---
  const feedback = Array.isArray(oldMemory.feedback) ? oldMemory.feedback as string[] : [];

  // --- Write the new action store ---
  const store: ActionStore = {
    actions,
    directives: feedback,
    lastConsolidation: null, // No consolidation has run on the new system yet
  };

  const dir = workflowDir(workflowName);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(actionsPath, JSON.stringify(store, null, 2) + "\n");

  // --- Initialize empty facts, observations, relationships stores ---
  initializeEmptyStores(workflowName, true); // skip actions.json since we just wrote it

  // --- Backup old memory.json ---
  try {
    renameSync(memoryPath, memoryPath + ".backup");
  } catch {
    // Ignore rename failures
  }

  info(`Memory migrated: ${actions.length} actions, ${feedback.length} directives → ${dim("actions.json")}`);
}

/** Create empty store files for facts, observations, and relationships.
 *  Optionally skip actions.json if it was already created. */
function initializeEmptyStores(workflowName: string, skipActions: boolean = false): void {
  const dir = workflowDir(workflowName);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // actions.json
  if (!skipActions && !existsSync(workflowActionsPath(workflowName))) {
    const emptyActions: ActionStore = { actions: [], directives: [], lastConsolidation: null };
    writeFileSync(workflowActionsPath(workflowName), JSON.stringify(emptyActions, null, 2) + "\n");
  }

  // facts.json
  if (!existsSync(workflowFactsPath(workflowName))) {
    const emptyFacts: FactStore = { facts: [] };
    writeFileSync(workflowFactsPath(workflowName), JSON.stringify(emptyFacts, null, 2) + "\n");
  }

  // observations.json
  if (!existsSync(workflowObservationsPath(workflowName))) {
    const emptyObs: ObservationStore = { observations: [], summaries: [] };
    writeFileSync(workflowObservationsPath(workflowName), JSON.stringify(emptyObs, null, 2) + "\n");
  }

  // relationships.json
  if (!existsSync(workflowRelationshipsPath(workflowName))) {
    const emptyRels: RelationshipStore = { accounts: [] };
    writeFileSync(workflowRelationshipsPath(workflowName), JSON.stringify(emptyRels, null, 2) + "\n");
  }
}

// --- Public API ---

/** Ensure all migrations have been applied. Safe to call multiple times.
 *  Runs two stages:
 *    1. Legacy flat → workflow directories (if needed)
 *    2. memory.json → actions.json for each workflow (if needed) */
export function ensureMigrated(): void {
  // Stage 1: Legacy flat structure → workflow directories
  migrateLegacyToWorkflows();

  // Stage 2: memory.json → actions.json for each existing workflow
  const workflowsDir = getWorkflowsDir();
  if (!existsSync(workflowsDir)) return;

  const entries = readdirSync(workflowsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      migrateMemoryToActions(entry.name);
    }
  }
}
