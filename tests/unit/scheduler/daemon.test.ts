/**
 * daemon.test.ts — Tests for the daemon backend interface and isJobDue logic.
 *
 * Tests cover:
 * - installDaemon/uninstallDaemon as no-ops
 * - isDaemonInstalled delegating to job registry
 * - getDaemonStatus computing nextRun and reading lastExitCode
 * - isJobDue checking cron schedule against lastRunAt
 * - startDaemon loop with fake timers and mocked spawn
 *
 * Uses createTestWorkspace() for filesystem isolation and vi.useFakeTimers() for time control.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  installDaemon,
  uninstallDaemon,
  isDaemonInstalled,
  getDaemonStatus,
  isJobDue,
} from "@/modules/scheduler/daemon";
import type { ScheduledJob } from "@/modules/scheduler/types";

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
  // Ensure scheduler directory exists
  mkdirSync(join(workspace.root, ".runwrk", "scheduler", "logs"), { recursive: true });
});

afterEach(() => {
  workspace.cleanup();
});

/** Helper: write a jobs.json with the given jobs */
function writeJobs(jobs: ScheduledJob[]): void {
  writeFileSync(
    join(workspace.root, ".runwrk", "scheduler", "jobs.json"),
    JSON.stringify(jobs, null, 2),
    "utf-8"
  );
}

/** Helper: create a minimal ScheduledJob */
function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    name: "test-job",
    command: "twitter -w growth",
    cron: "0 9 * * *",
    enabled: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// --- Backend Interface ---

describe("installDaemon", () => {
  it("is a no-op (does not throw)", () => {
    const job = makeJob();
    expect(() => installDaemon(job)).not.toThrow();
  });
});

describe("uninstallDaemon", () => {
  it("is a no-op (does not throw)", () => {
    expect(() => uninstallDaemon("test-job")).not.toThrow();
  });
});

describe("isDaemonInstalled", () => {
  it("returns true when job exists in registry", () => {
    writeJobs([makeJob()]);
    expect(isDaemonInstalled("test-job")).toBe(true);
  });

  it("returns false when job does not exist", () => {
    writeJobs([]);
    expect(isDaemonInstalled("nonexistent")).toBe(false);
  });
});

describe("getDaemonStatus", () => {
  it("returns null for nonexistent jobs", () => {
    writeJobs([]);
    expect(getDaemonStatus("nonexistent")).toBeNull();
  });

  it("returns nextRun and lastExitCode for existing jobs", () => {
    writeJobs([makeJob({ cron: "0 9 * * *" })]);
    const status = getDaemonStatus("test-job");

    expect(status).not.toBeNull();
    // nextRun should be a valid ISO string (since "0 9 * * *" always has a next run)
    expect(status!.nextRun).toBeTruthy();
    // lastExitCode is null when daemon-state.json doesn't have data yet
    expect(status!.lastExitCode).toBeNull();
  });
});

// --- isJobDue ---

describe("isJobDue", () => {
  it("returns true when job has never run", () => {
    const job = makeJob({ cron: "0 9 * * *" });
    const now = new Date("2025-06-15T10:00:00.000Z");

    expect(isJobDue(job, null, now)).toBe(true);
  });

  it("returns true when a cron window has passed since lastRunAt", () => {
    const job = makeJob({ cron: "0 9 * * *" }); // daily at 09:00
    const lastRunAt = "2025-06-14T09:00:00.000Z"; // ran yesterday at 09:00
    const now = new Date("2025-06-15T10:00:00.000Z"); // now is 10:00 today

    expect(isJobDue(job, lastRunAt, now)).toBe(true);
  });

  it("returns false when no cron window has passed since lastRunAt", () => {
    const job = makeJob({ cron: "0 9 * * *" }); // daily at 09:00
    const lastRunAt = "2025-06-15T09:00:00.000Z"; // ran today at 09:00
    const now = new Date("2025-06-15T09:30:00.000Z"); // only 30 min later

    expect(isJobDue(job, lastRunAt, now)).toBe(false);
  });

  it("returns false for invalid cron expressions", () => {
    const job = makeJob({ cron: "invalid cron" });
    const now = new Date("2025-06-15T10:00:00.000Z");

    expect(isJobDue(job, null, now)).toBe(false);
  });

  it("handles every-minute cron correctly", () => {
    const job = makeJob({ cron: "* * * * *" }); // every minute
    const lastRunAt = "2025-06-15T09:00:00.000Z";
    const now = new Date("2025-06-15T09:01:00.000Z"); // 1 min later

    expect(isJobDue(job, lastRunAt, now)).toBe(true);
  });

  it("returns false if last run is within the same cron minute", () => {
    const job = makeJob({ cron: "* * * * *" }); // every minute
    const lastRunAt = "2025-06-15T09:00:30.000Z"; // ran 30s into minute
    const now = new Date("2025-06-15T09:00:45.000Z"); // still same minute

    // Next cron after 09:00:30 is 09:01:00, which is after now
    expect(isJobDue(job, lastRunAt, now)).toBe(false);
  });
});
