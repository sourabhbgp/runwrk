/**
 * jobs.test.ts — Tests for the scheduler job registry CRUD operations.
 *
 * Uses createTestWorkspace() for filesystem isolation. Each test gets a clean
 * .runwrk/ directory with no pre-existing scheduler data.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../../helpers";
import {
  listJobs,
  getJob,
  addJob,
  removeJob,
  updateJob,
  ensureSchedulerDir,
} from "@/modules/scheduler/jobs";
import { existsSync } from "fs";
import { join } from "path";

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
});

afterEach(() => {
  workspace.cleanup();
});

// --- ensureSchedulerDir ---

describe("ensureSchedulerDir", () => {
  it("creates .runwrk/scheduler/ and logs/ directories", () => {
    ensureSchedulerDir();

    expect(existsSync(join(workspace.root, ".runwrk", "scheduler"))).toBe(true);
    expect(existsSync(join(workspace.root, ".runwrk", "scheduler", "logs"))).toBe(true);
  });

  it("is idempotent — calling twice does not error", () => {
    ensureSchedulerDir();
    ensureSchedulerDir();

    expect(existsSync(join(workspace.root, ".runwrk", "scheduler"))).toBe(true);
  });
});

// --- listJobs ---

describe("listJobs", () => {
  it("returns empty array when no jobs.json exists", () => {
    const jobs = listJobs();
    expect(jobs).toEqual([]);
  });

  it("returns all jobs after adding them", () => {
    addJob({ name: "job-a", command: "twitter -w growth", cron: "0 9 * * *" });
    addJob({ name: "job-b", command: "twitter -w niche", cron: "0 14 * * *" });

    const jobs = listJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe("job-a");
    expect(jobs[1].name).toBe("job-b");
  });
});

// --- getJob ---

describe("getJob", () => {
  it("returns null for non-existent job", () => {
    expect(getJob("nonexistent")).toBeNull();
  });

  it("finds an existing job by name", () => {
    addJob({ name: "my-job", command: "twitter -w test", cron: "0 12 * * *" });

    const job = getJob("my-job");
    expect(job).not.toBeNull();
    expect(job!.name).toBe("my-job");
    expect(job!.command).toBe("twitter -w test");
    expect(job!.cron).toBe("0 12 * * *");
  });
});

// --- addJob ---

describe("addJob", () => {
  it("creates a new job with enabled=true and createdAt timestamp", () => {
    const job = addJob({
      name: "test-job",
      command: "twitter -w growth",
      cron: "0 9,14,20 * * *",
      description: "Run growth workflow 3x daily",
    });

    expect(job.name).toBe("test-job");
    expect(job.enabled).toBe(true);
    expect(job.createdAt).toBeTruthy();
    expect(job.description).toBe("Run growth workflow 3x daily");
  });

  it("persists to jobs.json", () => {
    addJob({ name: "persist-test", command: "chat", cron: "0 8 * * 1" });

    // Read back from disk
    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("persist-test");
  });

  it("throws on duplicate job name", () => {
    addJob({ name: "dup-job", command: "twitter -w a", cron: "0 9 * * *" });

    expect(() => {
      addJob({ name: "dup-job", command: "twitter -w b", cron: "0 10 * * *" });
    }).toThrow(/already exists/);
  });

  it("preserves optional timezone field", () => {
    const job = addJob({
      name: "tz-job",
      command: "twitter -w test",
      cron: "0 9 * * *",
      timezone: "America/New_York",
    });

    expect(job.timezone).toBe("America/New_York");
  });
});

// --- removeJob ---

describe("removeJob", () => {
  it("returns false for non-existent job", () => {
    expect(removeJob("ghost")).toBe(false);
  });

  it("removes an existing job and returns true", () => {
    addJob({ name: "to-remove", command: "twitter -w test", cron: "0 9 * * *" });

    expect(removeJob("to-remove")).toBe(true);
    expect(getJob("to-remove")).toBeNull();
    expect(listJobs()).toHaveLength(0);
  });

  it("only removes the specified job, leaving others intact", () => {
    addJob({ name: "keep-me", command: "twitter -w a", cron: "0 9 * * *" });
    addJob({ name: "remove-me", command: "twitter -w b", cron: "0 10 * * *" });

    removeJob("remove-me");

    const jobs = listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("keep-me");
  });
});

// --- updateJob ---

describe("updateJob", () => {
  it("throws for non-existent job", () => {
    expect(() => updateJob("ghost", { enabled: false })).toThrow(/not found/);
  });

  it("updates enabled field", () => {
    addJob({ name: "toggle-job", command: "twitter -w test", cron: "0 9 * * *" });

    const updated = updateJob("toggle-job", { enabled: false });
    expect(updated.enabled).toBe(false);

    // Verify persisted
    const fromDisk = getJob("toggle-job");
    expect(fromDisk!.enabled).toBe(false);
  });

  it("updates cron expression", () => {
    addJob({ name: "cron-job", command: "twitter -w test", cron: "0 9 * * *" });

    const updated = updateJob("cron-job", { cron: "0 12 * * *" });
    expect(updated.cron).toBe("0 12 * * *");
  });

  it("updates description", () => {
    addJob({ name: "desc-job", command: "chat", cron: "0 8 * * *" });

    const updated = updateJob("desc-job", { description: "Morning chat" });
    expect(updated.description).toBe("Morning chat");
  });

  it("preserves unchanged fields", () => {
    addJob({
      name: "partial-update",
      command: "twitter -w test",
      cron: "0 9 * * *",
      description: "Original desc",
    });

    const updated = updateJob("partial-update", { enabled: false });
    expect(updated.command).toBe("twitter -w test");
    expect(updated.cron).toBe("0 9 * * *");
    expect(updated.description).toBe("Original desc");
  });
});
