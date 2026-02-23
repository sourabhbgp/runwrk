/**
 * workflow.migrate.ts — One-time migration from the old flat structure to workflows.
 *
 * The old layout stored everything in `.myteam/twitter-memory.json` (single flat file).
 * This migrates to the new per-workflow structure:
 *   - blockedAccounts → .myteam/twitter-global.json (shared safety state)
 *   - remaining memory → .myteam/workflows/default/memory.json
 *   - config → .myteam/workflows/default/workflow.json (built via custom template)
 *
 * Old files are renamed to .backup — never deleted.
 * Called at the top of any workflow-aware command.
 */

import { readFileSync, existsSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { writeWorkflowConfig, writeGlobalSafety, workflowDir, workflowMemoryPath } from "./workflow";
import { createCustomWorkflow } from "./workflow.templates";
import { writeFileSync } from "fs";
import { info, dim } from "../../common";

const BASE_DIR = join(process.cwd(), ".myteam");
const WORKFLOWS_DIR = join(BASE_DIR, "workflows");
const OLD_MEMORY_PATH = join(BASE_DIR, "twitter-memory.json");
const OLD_CONFIG_PATH = join(BASE_DIR, "twitter-config.json");

/** Ensure the old flat structure has been migrated to workflow directories.
 *  Safe to call multiple times — no-ops if already migrated. */
export function ensureMigrated(): void {
  // Already migrated — workflows directory exists
  if (existsSync(WORKFLOWS_DIR)) return;

  // No old memory file — fresh install, just create the empty workflows dir
  if (!existsSync(OLD_MEMORY_PATH)) {
    mkdirSync(WORKFLOWS_DIR, { recursive: true });
    return;
  }

  info(`Migrating to workflow system...`);

  // --- Read old data ---
  let oldMemory: Record<string, unknown> = {};
  try {
    oldMemory = JSON.parse(readFileSync(OLD_MEMORY_PATH, "utf-8"));
  } catch {
    // Corrupt file — proceed with empty data
  }

  let oldConfig: Record<string, unknown> = {};
  try {
    if (existsSync(OLD_CONFIG_PATH)) {
      oldConfig = JSON.parse(readFileSync(OLD_CONFIG_PATH, "utf-8"));
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
      maxPostsPerDay: typeof oldLimits.maxPostsPerDay === "number" ? oldLimits.maxPostsPerDay : 3,
      delayBetweenActions: Array.isArray(oldLimits.delayBetweenActions)
        ? (oldLimits.delayBetweenActions as [number, number])
        : [2000, 5000],
    },
  });

  writeWorkflowConfig("default", defaultWorkflow);

  // --- Backup old files (preserve, never delete) ---
  try {
    renameSync(OLD_MEMORY_PATH, OLD_MEMORY_PATH + ".backup");
  } catch {
    // Ignore rename failures (permissions, etc.)
  }

  info(`Migration complete. Your data is now in ${dim("workflows/default/")}`);
  info(`Old files renamed to .backup`);
}
