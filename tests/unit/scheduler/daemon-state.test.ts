/**
 * daemon-state.test.ts — Tests for daemon state persistence (daemon-state.json).
 *
 * Tests cover:
 * - readDaemonState() returning fresh state when file doesn't exist
 * - writeDaemonState() persisting to disk
 * - getJobState() creating and returning per-job entries
 * - updateJobState() merging updates and persisting
 *
 * Uses createTestWorkspace() for filesystem isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  readDaemonState,
  writeDaemonState,
  getJobState,
  updateJobState,
} from "@/modules/scheduler/daemon-state";

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
});

afterEach(() => {
  workspace.cleanup();
});

// --- readDaemonState ---

describe("readDaemonState", () => {
  it("returns fresh state when daemon-state.json doesn't exist", () => {
    const state = readDaemonState();

    expect(state.jobs).toEqual({});
    expect(state.startedAt).toBeTruthy();
  });

  it("reads existing state from disk", () => {
    const existing = {
      jobs: {
        "test-job": {
          name: "test-job",
          lastRunAt: "2025-01-01T00:00:00.000Z",
          lastExitCode: 0,
          running: false,
        },
      },
      startedAt: "2025-01-01T00:00:00.000Z",
    };

    // Manually write state file
    const dir = join(workspace.root, ".runwrk", "scheduler");
    const { mkdirSync, writeFileSync } = require("fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "daemon-state.json"), JSON.stringify(existing), "utf-8");

    const state = readDaemonState();
    expect(state.jobs["test-job"].lastExitCode).toBe(0);
    expect(state.startedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

// --- writeDaemonState ---

describe("writeDaemonState", () => {
  it("persists state to daemon-state.json", () => {
    const state = {
      jobs: {},
      startedAt: "2025-01-01T00:00:00.000Z",
    };

    writeDaemonState(state);

    const filePath = join(workspace.root, ".runwrk", "scheduler", "daemon-state.json");
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.startedAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

// --- getJobState ---

describe("getJobState", () => {
  it("creates a fresh entry for an unknown job", () => {
    const state = readDaemonState();
    const jobState = getJobState(state, "new-job");

    expect(jobState.name).toBe("new-job");
    expect(jobState.lastRunAt).toBeNull();
    expect(jobState.lastExitCode).toBeNull();
    expect(jobState.running).toBe(false);
  });

  it("returns existing entry if already present", () => {
    const state = readDaemonState();
    state.jobs["existing"] = {
      name: "existing",
      lastRunAt: "2025-06-01T00:00:00.000Z",
      lastExitCode: 42,
      lastDurationMs: null,
      running: true,
    };

    const jobState = getJobState(state, "existing");
    expect(jobState.lastExitCode).toBe(42);
    expect(jobState.running).toBe(true);
  });
});

// --- updateJobState ---

describe("updateJobState", () => {
  it("merges partial updates into a job's state", () => {
    const state = readDaemonState();
    getJobState(state, "my-job"); // initialize

    const updated = updateJobState(state, "my-job", {
      lastRunAt: "2025-06-15T12:00:00.000Z",
      lastExitCode: 0,
    });

    expect(updated.jobs["my-job"].lastRunAt).toBe("2025-06-15T12:00:00.000Z");
    expect(updated.jobs["my-job"].lastExitCode).toBe(0);
    expect(updated.jobs["my-job"].running).toBe(false); // unchanged
  });

  it("persists to disk after update", () => {
    const state = readDaemonState();
    updateJobState(state, "persisted-job", { lastExitCode: 1 });

    // Read back from disk
    const freshState = readDaemonState();
    expect(freshState.jobs["persisted-job"].lastExitCode).toBe(1);
  });
});
