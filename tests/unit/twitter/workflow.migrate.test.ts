/**
 * Tests for the one-time migration from legacy flat twitter storage
 * to the workflow-based directory structure.
 *
 * Verifies that ensureMigrated() handles fresh installs, no-ops when
 * already migrated, moves memory and config into workflows/default/,
 * extracts blocked accounts into global safety state, and renames
 * old files to .backup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { ensureMigrated } from "@/modules/twitter/workflow.migrate";

// Mock the console output from info/dim used during migration
vi.mock("@/common", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/common")>();
  return {
    ...original,
    info: vi.fn(),
    dim: vi.fn((s: string) => s),
  };
});

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
  // Remove the workflows dir to simulate pre-migration state
  rmSync(workspace.workflowsDir, { recursive: true });
});

afterEach(() => {
  workspace.cleanup();
});

// --- No-Op Case ---

describe("ensureMigrated (no-op)", () => {
  it("no-ops when workflows directory already exists", () => {
    // Recreate the workflows dir to simulate already-migrated state
    mkdirSync(workspace.workflowsDir, { recursive: true });

    ensureMigrated();

    // Should not create a default workflow — just return early
    expect(existsSync(join(workspace.workflowsDir, "default"))).toBe(false);
  });
});

// --- Fresh Install ---

describe("ensureMigrated (fresh install)", () => {
  it("creates empty workflows directory when no old memory file exists", () => {
    // No old files exist, no workflows dir — fresh install
    expect(existsSync(workspace.workflowsDir)).toBe(false);

    ensureMigrated();

    // Should create the workflows dir but no default workflow
    expect(existsSync(workspace.workflowsDir)).toBe(true);
    expect(existsSync(join(workspace.workflowsDir, "default"))).toBe(false);
  });
});

// --- Full Migration ---

describe("ensureMigrated (full migration)", () => {
  it("migrates legacy memory into workflows/default/ and extracts blocked accounts", () => {
    // Write a legacy memory file with engagement data and blocked accounts
    const oldMemory = {
      repliedTo: [{ tweetId: "t1", userId: "u1", username: "alice", date: "2026-01-01" }],
      liked: ["t2"],
      blockedAccounts: ["spamuser"],
      feedback: ["Be concise"],
    };
    writeFileSync(
      join(workspace.runwrkDir, "twitter-memory.json"),
      JSON.stringify(oldMemory, null, 2),
    );

    ensureMigrated();

    // 1. Default workflow directory should exist
    const defaultDir = join(workspace.workflowsDir, "default");
    expect(existsSync(defaultDir)).toBe(true);

    // 2. Stage 2 should have migrated memory.json → actions.json
    //    memory.json should be renamed to memory.json.backup
    const memoryPath = join(defaultDir, "memory.json");
    const memoryBackupPath = join(defaultDir, "memory.json.backup");
    const actionsPath = join(defaultDir, "actions.json");
    expect(existsSync(memoryPath)).toBe(false);
    expect(existsSync(memoryBackupPath)).toBe(true);
    expect(existsSync(actionsPath)).toBe(true);

    // actions.json should contain migrated actions + directives
    const actionsStore = JSON.parse(readFileSync(actionsPath, "utf-8"));
    const replies = actionsStore.actions.filter((a: { type: string }) => a.type === "reply");
    const likes = actionsStore.actions.filter((a: { type: string }) => a.type === "like");
    expect(replies).toHaveLength(1);
    expect(replies[0].tweetId).toBe("t1");
    expect(likes).toHaveLength(1);
    expect(likes[0].tweetId).toBe("t2");
    expect(actionsStore.directives).toEqual(["Be concise"]);

    // facts, observations, relationships stores should be initialized
    expect(existsSync(join(defaultDir, "facts.json"))).toBe(true);
    expect(existsSync(join(defaultDir, "observations.json"))).toBe(true);
    expect(existsSync(join(defaultDir, "relationships.json"))).toBe(true);

    // 3. twitter-global.json should contain the extracted blocked accounts
    const globalPath = join(workspace.runwrkDir, "twitter-global.json");
    expect(existsSync(globalPath)).toBe(true);
    const global = JSON.parse(readFileSync(globalPath, "utf-8"));
    expect(global.blockedAccounts).toEqual(["spamuser"]);

    // 4. workflow.json should exist for the default workflow
    const workflowPath = join(defaultDir, "workflow.json");
    expect(existsSync(workflowPath)).toBe(true);
    const workflowConfig = JSON.parse(readFileSync(workflowPath, "utf-8"));
    expect(workflowConfig.name).toBe("default");

    // 5. Old file should be renamed to .backup
    const oldPath = join(workspace.runwrkDir, "twitter-memory.json");
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(oldPath + ".backup")).toBe(true);
  });

  it("migration preserves old config values in the default workflow", () => {
    // Write legacy memory file (required to trigger migration)
    writeFileSync(
      join(workspace.runwrkDir, "twitter-memory.json"),
      JSON.stringify({ repliedTo: [], blockedAccounts: [] }),
    );

    // Write legacy config with topics, keywords, and custom limits
    const oldConfig = {
      topics: ["typescript", "bun"],
      keywords: ["react", "nextjs"],
      watchAccounts: ["@denoland"],
      limits: {
        maxLikesPerSession: 20,
        maxRepliesPerSession: 8,
        maxPostsPerDay: 6,
        delayBetweenActions: [1000, 3000],
      },
    };
    writeFileSync(
      join(workspace.runwrkDir, "twitter-config.json"),
      JSON.stringify(oldConfig, null, 2),
    );

    ensureMigrated();

    // Read the generated default workflow config
    const workflowPath = join(workspace.workflowsDir, "default", "workflow.json");
    const workflowConfig = JSON.parse(readFileSync(workflowPath, "utf-8"));

    // Topics, keywords, and watchAccounts should be carried over
    expect(workflowConfig.topics).toEqual(["typescript", "bun"]);
    expect(workflowConfig.keywords).toEqual(["react", "nextjs"]);
    expect(workflowConfig.watchAccounts).toEqual(["@denoland"]);

    // Limits should match the old config values
    expect(workflowConfig.limits.maxLikesPerSession).toBe(20);
    expect(workflowConfig.limits.maxRepliesPerSession).toBe(8);
    expect(workflowConfig.limits.maxPostsPerDay).toBe(6);
    expect(workflowConfig.limits.delayBetweenActions).toEqual([1000, 3000]);
  });
});
