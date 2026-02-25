/**
 * Tests for workflow CRUD operations and global safety state persistence.
 *
 * Covers path helpers, listing, existence checks, read/write round-trips,
 * deletion, global blocklist management, and daily post counting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { createMockWorkflowConfig } from "../../helpers/mock-data";
import {
  workflowDir,
  workflowConfigPath,
  workflowMemoryPath,
  listWorkflows,
  workflowExists,
  readWorkflowConfig,
  writeWorkflowConfig,
  deleteWorkflow,
  readGlobalSafety,
  writeGlobalSafety,
  globalBlockAccount,
  isGloballyBlocked,
  incrementGlobalDailyPosts,
  getGlobalDailyPostCount,
} from "@/modules/twitter/workflow";

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
});

afterEach(() => {
  workspace.cleanup();
});

// --- Path Helpers ---

describe("path helpers", () => {
  it("workflowDir returns a path containing the workflow name", () => {
    const dir = workflowDir("my-campaign");
    expect(dir).toContain("my-campaign");
    expect(dir).toContain(".runwrk/workflows/");
  });

  it("workflowConfigPath returns a path containing the workflow name and workflow.json", () => {
    const path = workflowConfigPath("my-campaign");
    expect(path).toContain("my-campaign");
    expect(path).toMatch(/workflow\.json$/);
  });

  it("workflowMemoryPath returns a path containing the workflow name and memory.json", () => {
    const path = workflowMemoryPath("my-campaign");
    expect(path).toContain("my-campaign");
    expect(path).toMatch(/memory\.json$/);
  });
});

// --- Workflow CRUD ---

describe("workflow CRUD", () => {
  it("listWorkflows returns empty array when no workflows exist", () => {
    // The workflows dir exists (created by fixture) but contains no subdirectories
    const workflows = listWorkflows();
    expect(workflows).toEqual([]);
  });

  it("writeWorkflowConfig + listWorkflows shows the workflow", () => {
    const config = createMockWorkflowConfig({ name: "growth" });
    writeWorkflowConfig("growth", config);

    const workflows = listWorkflows();
    expect(workflows).toContain("growth");
  });

  it("writeWorkflowConfig + readWorkflowConfig round-trips the data", () => {
    const config = createMockWorkflowConfig({
      name: "niche",
      template: "hashtag-niche",
      topics: ["rust", "wasm"],
      strategyPrompt: "Focus on Rust ecosystem.",
    });
    writeWorkflowConfig("niche", config);

    const loaded = readWorkflowConfig("niche");
    expect(loaded.name).toBe("niche");
    expect(loaded.template).toBe("hashtag-niche");
    expect(loaded.topics).toEqual(["rust", "wasm"]);
    expect(loaded.strategyPrompt).toBe("Focus on Rust ecosystem.");
  });

  it("workflowExists returns false for missing, true after write", () => {
    expect(workflowExists("phantom")).toBe(false);

    const config = createMockWorkflowConfig({ name: "phantom" });
    writeWorkflowConfig("phantom", config);

    expect(workflowExists("phantom")).toBe(true);
  });

  it("deleteWorkflow removes the workflow directory", () => {
    const config = createMockWorkflowConfig({ name: "doomed" });
    writeWorkflowConfig("doomed", config);
    expect(workflowExists("doomed")).toBe(true);

    deleteWorkflow("doomed");

    expect(workflowExists("doomed")).toBe(false);
    expect(listWorkflows()).not.toContain("doomed");
  });

  it("readWorkflowConfig throws for non-existent workflow", () => {
    expect(() => readWorkflowConfig("nonexistent")).toThrow(
      /Workflow "nonexistent" not found/,
    );
  });
});

// --- Global Safety State ---

describe("global safety state", () => {
  it("readGlobalSafety returns empty state when no file exists", () => {
    const state = readGlobalSafety();
    expect(state.blockedAccounts).toEqual([]);
    expect(state.dailyPostCounts).toEqual({});
  });

  it("writeGlobalSafety + readGlobalSafety round-trips", () => {
    const state = {
      blockedAccounts: ["spammer", "scambot"],
      dailyPostCounts: { "2026-03-01": 5 },
    };
    writeGlobalSafety(state);

    const loaded = readGlobalSafety();
    expect(loaded.blockedAccounts).toEqual(["spammer", "scambot"]);
    expect(loaded.dailyPostCounts).toEqual({ "2026-03-01": 5 });
  });

  it("globalBlockAccount adds a username and isGloballyBlocked finds it (case-insensitive, strips @)", () => {
    globalBlockAccount("@SpamUser");

    // Should be found regardless of case or @ prefix
    expect(isGloballyBlocked("spamuser")).toBe(true);
    expect(isGloballyBlocked("SpamUser")).toBe(true);
    expect(isGloballyBlocked("@spamuser")).toBe(true);
    expect(isGloballyBlocked("@SPAMUSER")).toBe(true);
  });

  it("globalBlockAccount doesn't duplicate entries", () => {
    globalBlockAccount("duplicate");
    globalBlockAccount("duplicate");
    globalBlockAccount("DUPLICATE");

    const state = readGlobalSafety();
    const matches = state.blockedAccounts.filter((a) => a === "duplicate");
    expect(matches).toHaveLength(1);
  });
});

// --- Daily Post Counting (requires fake timers) ---

describe("daily post counting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getGlobalDailyPostCount returns 0 when no posts exist", () => {
    expect(getGlobalDailyPostCount()).toBe(0);
  });

  it("incrementGlobalDailyPosts increments and returns new count", () => {
    const first = incrementGlobalDailyPosts();
    expect(first).toBe(1);

    const second = incrementGlobalDailyPosts();
    expect(second).toBe(2);

    const third = incrementGlobalDailyPosts();
    expect(third).toBe(3);
  });

  it("getGlobalDailyPostCount returns correct count after incrementing", () => {
    incrementGlobalDailyPosts();
    incrementGlobalDailyPosts();

    expect(getGlobalDailyPostCount()).toBe(2);
  });
});
