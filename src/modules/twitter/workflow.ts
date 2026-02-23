/**
 * workflow.ts — Persistence layer for workflow directories and global safety state.
 *
 * Each workflow lives in `.myteam/workflows/<name>/` with its own workflow.json
 * and memory.json. Global safety state (blocked accounts, daily post limits) is
 * shared across all workflows via `.myteam/twitter-global.json`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import type { WorkflowConfig, GlobalSafetyState } from "./workflow.types";

// --- Path Helpers (lazy — evaluated on each call for testability) ---

/** Get the base .myteam directory path */
function getBaseDir(): string { return join(process.cwd(), ".myteam"); }

/** Get the workflows root directory path */
function getWorkflowsDir(): string { return join(getBaseDir(), "workflows"); }

/** Get the global safety state file path */
function getGlobalSafetyPath(): string { return join(getBaseDir(), "twitter-global.json"); }

/** Get the directory path for a named workflow */
export function workflowDir(name: string): string {
  return join(getWorkflowsDir(), name);
}

/** Get the workflow.json path for a named workflow */
export function workflowConfigPath(name: string): string {
  return join(workflowDir(name), "workflow.json");
}

/** Get the memory.json path for a named workflow */
export function workflowMemoryPath(name: string): string {
  return join(workflowDir(name), "memory.json");
}

/** Ensure the workflows root directory exists */
function ensureWorkflowsDir(): void {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Workflow CRUD ---

/** List all workflow names by scanning the workflows directory */
export function listWorkflows(): string[] {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Check if a workflow with the given name exists */
export function workflowExists(name: string): boolean {
  return existsSync(workflowConfigPath(name));
}

/** Read a workflow's config from disk, throwing if it doesn't exist */
export function readWorkflowConfig(name: string): WorkflowConfig {
  const path = workflowConfigPath(name);
  if (!existsSync(path)) {
    throw new Error(`Workflow "${name}" not found. Run \`myteam twitter workflow create\` first.`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as WorkflowConfig;
}

/** Write a workflow config to disk, creating the directory if needed */
export function writeWorkflowConfig(name: string, config: WorkflowConfig): void {
  ensureWorkflowsDir();
  const dir = workflowDir(name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(workflowConfigPath(name), JSON.stringify(config, null, 2) + "\n");
}

/** Delete a workflow's entire directory (config + memory) */
export function deleteWorkflow(name: string): void {
  const dir = workflowDir(name);
  if (existsSync(dir)) rmSync(dir, { recursive: true });
}

// --- Global Safety State ---

/** Default empty global safety state */
const EMPTY_SAFETY: GlobalSafetyState = {
  blockedAccounts: [],
  dailyPostCounts: {},
};

/** Read global safety state from disk */
export function readGlobalSafety(): GlobalSafetyState {
  const path = getGlobalSafetyPath();
  if (!existsSync(path)) return { ...EMPTY_SAFETY, blockedAccounts: [], dailyPostCounts: {} };
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...EMPTY_SAFETY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_SAFETY, blockedAccounts: [], dailyPostCounts: {} };
  }
}

/** Write global safety state to disk */
export function writeGlobalSafety(state: GlobalSafetyState): void {
  const baseDir = getBaseDir();
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  writeFileSync(getGlobalSafetyPath(), JSON.stringify(state, null, 2) + "\n");
}

/** Add a username to the global blocklist (shared across all workflows) */
export function globalBlockAccount(username: string): void {
  const state = readGlobalSafety();
  const normalized = username.toLowerCase().replace(/^@/, "");
  if (!state.blockedAccounts.includes(normalized)) {
    state.blockedAccounts.push(normalized);
    writeGlobalSafety(state);
  }
}

/** Check if a username is on the global blocklist */
export function isGloballyBlocked(username: string): boolean {
  const state = readGlobalSafety();
  return state.blockedAccounts.includes(username.toLowerCase().replace(/^@/, ""));
}

/** Return today's date as YYYY-MM-DD */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Increment today's global post count and return the new value */
export function incrementGlobalDailyPosts(): number {
  const state = readGlobalSafety();
  const key = todayKey();
  state.dailyPostCounts[key] = (state.dailyPostCounts[key] ?? 0) + 1;
  writeGlobalSafety(state);
  return state.dailyPostCounts[key];
}

/** Get today's global post count across all workflows */
export function getGlobalDailyPostCount(): number {
  const state = readGlobalSafety();
  return state.dailyPostCounts[todayKey()] ?? 0;
}
