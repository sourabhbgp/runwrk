/**
 * Tests for twitter config persistence — verifying readConfig, writeConfig,
 * and mergedLimits handle defaults, partial files, round-trips, and
 * workflow-level limit overrides correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { join } from "path";
import { readConfig, writeConfig, mergedLimits } from "@/modules/twitter/config";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { createMockWorkflowConfig } from "../../helpers/mock-data";

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
});

afterEach(() => {
  workspace.cleanup();
});

// --- readConfig ---

describe("readConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = readConfig();

    expect(config.topics).toEqual([]);
    expect(config.keywords).toEqual([]);
    expect(config.watchAccounts).toEqual([]);
    expect(config.limits).toEqual({
      maxLikesPerSession: 10,
      maxRepliesPerSession: 5,
      maxFollowsPerSession: 3,
      maxPostsPerDay: 3,
      delayBetweenActions: [2000, 5000],
    });
  });

  it("reads and merges with defaults when file exists with partial data", () => {
    // Write a config file that only has topics — everything else should get defaults
    const partial = { topics: ["ai", "ml"] };
    writeFileSync(
      join(workspace.runwrkDir, "twitter-config.json"),
      JSON.stringify(partial, null, 2),
    );

    const config = readConfig();

    // Explicitly set field should be present
    expect(config.topics).toEqual(["ai", "ml"]);

    // Missing fields should get default values
    expect(config.keywords).toEqual([]);
    expect(config.watchAccounts).toEqual([]);
    expect(config.limits).toEqual({
      maxLikesPerSession: 10,
      maxRepliesPerSession: 5,
      maxFollowsPerSession: 3,
      maxPostsPerDay: 3,
      delayBetweenActions: [2000, 5000],
    });
  });
});

// --- writeConfig + readConfig Round-Trip ---

describe("writeConfig", () => {
  it("creates the file and readConfig reads it back correctly", () => {
    const config = {
      topics: ["typescript", "webdev"],
      keywords: ["react", "bun"],
      watchAccounts: ["@denoland"],
      limits: {
        maxLikesPerSession: 20,
        maxRepliesPerSession: 8,
        maxFollowsPerSession: 3,
        maxPostsPerDay: 5,
        delayBetweenActions: [1000, 3000] as [number, number],
      },
    };

    writeConfig(config);
    const loaded = readConfig();

    expect(loaded.topics).toEqual(config.topics);
    expect(loaded.keywords).toEqual(config.keywords);
    expect(loaded.watchAccounts).toEqual(config.watchAccounts);
    expect(loaded.limits).toEqual(config.limits);
  });
});

// --- mergedLimits ---

describe("mergedLimits", () => {
  it("without workflow returns global config limits", () => {
    // Write a global config with custom limits
    writeConfig({
      topics: [],
      keywords: [],
      watchAccounts: [],
      limits: {
        maxLikesPerSession: 15,
        maxRepliesPerSession: 7,
        maxFollowsPerSession: 3,
        maxPostsPerDay: 4,
        delayBetweenActions: [1500, 4000],
      },
    });

    const limits = mergedLimits();

    expect(limits.maxLikesPerSession).toBe(15);
    expect(limits.maxRepliesPerSession).toBe(7);
    expect(limits.maxPostsPerDay).toBe(4);
    expect(limits.delayBetweenActions).toEqual([1500, 4000]);
  });

  it("with workflow overrides global limits", () => {
    // Write a global config with default-ish limits
    writeConfig({
      topics: [],
      keywords: [],
      watchAccounts: [],
      limits: {
        maxLikesPerSession: 10,
        maxRepliesPerSession: 5,
        maxFollowsPerSession: 3,
        maxPostsPerDay: 3,
        delayBetweenActions: [2000, 5000],
      },
    });

    // Create a workflow that overrides all limits
    const workflow = createMockWorkflowConfig({
      limits: {
        maxLikesPerSession: 25,
        maxRepliesPerSession: 12,
        maxFollowsPerSession: 5,
        maxPostsPerDay: 10,
        delayBetweenActions: [500, 1500],
      },
    });

    const limits = mergedLimits(workflow);

    // Workflow limits should take precedence over global
    expect(limits.maxPostsPerDay).toBe(10);
    expect(limits.maxLikesPerSession).toBe(25);
    expect(limits.maxRepliesPerSession).toBe(12);
    expect(limits.delayBetweenActions).toEqual([500, 1500]);
  });
});
