/**
 * logs.test.ts — Tests for scheduler log reading, clearing, and timestamp extraction.
 *
 * Uses createTestWorkspace() for filesystem isolation. Log files are written
 * manually to simulate scheduler output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../../helpers";
import { readJobLogs, clearJobLogs, getLastRunTimestamp } from "@/modules/scheduler/logs";
import { ensureSchedulerDir, getLogsDir } from "@/modules/scheduler/jobs";
import { writeFileSync } from "fs";
import { join } from "path";

let workspace: TestWorkspace;

beforeEach(() => {
  workspace = createTestWorkspace();
  ensureSchedulerDir();
});

afterEach(() => {
  workspace.cleanup();
});

/** Write content to a job's stdout log file */
function writeStdout(name: string, content: string): void {
  writeFileSync(join(getLogsDir(), `${name}.stdout.log`), content, "utf-8");
}

/** Write content to a job's stderr log file */
function writeStderr(name: string, content: string): void {
  writeFileSync(join(getLogsDir(), `${name}.stderr.log`), content, "utf-8");
}

// --- readJobLogs ---

describe("readJobLogs", () => {
  it("returns empty strings when no log files exist", () => {
    const { stdout, stderr } = readJobLogs("nonexistent");
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("reads stdout content", () => {
    writeStdout("test-job", "line 1\nline 2\nline 3\n");

    const { stdout } = readJobLogs("test-job");
    expect(stdout).toContain("line 1");
    expect(stdout).toContain("line 3");
  });

  it("reads stderr content", () => {
    writeStderr("test-job", "error: something failed\n");

    const { stderr } = readJobLogs("test-job");
    expect(stderr).toContain("error: something failed");
  });

  it("tails last N lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `log line ${i + 1}`);
    writeStdout("big-log", lines.join("\n") + "\n");

    const { stdout } = readJobLogs("big-log", 5);
    expect(stdout).toContain("log line 100");
    expect(stdout).toContain("log line 96");
    expect(stdout).not.toContain("log line 95\n");
  });

  it("handles files without trailing newline", () => {
    writeStdout("no-newline", "line 1\nline 2");

    const { stdout } = readJobLogs("no-newline", 2);
    expect(stdout).toContain("line 1");
    expect(stdout).toContain("line 2");
  });
});

// --- clearJobLogs ---

describe("clearJobLogs", () => {
  it("truncates existing log files to empty", () => {
    writeStdout("clear-test", "some output\n");
    writeStderr("clear-test", "some error\n");

    clearJobLogs("clear-test");

    const { stdout, stderr } = readJobLogs("clear-test");
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("does not throw when log files do not exist", () => {
    expect(() => clearJobLogs("nonexistent")).not.toThrow();
  });
});

// --- getLastRunTimestamp ---

describe("getLastRunTimestamp", () => {
  it("returns null when no log file exists", () => {
    expect(getLastRunTimestamp("nonexistent")).toBeNull();
  });

  it("returns null for empty log file", () => {
    writeStdout("empty-log", "");
    expect(getLastRunTimestamp("empty-log")).toBeNull();
  });

  it("returns ISO timestamp when log has content", () => {
    writeStdout("has-output", "job ran successfully\n");

    const ts = getLastRunTimestamp("has-output");
    expect(ts).toBeTruthy();
    // Should be a valid ISO string
    expect(new Date(ts!).toISOString()).toBe(ts);
  });
});
