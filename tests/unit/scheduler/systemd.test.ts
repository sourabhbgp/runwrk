/**
 * systemd.test.ts — Tests for Linux systemd unit file generation and cron conversion.
 *
 * Tests cover:
 * - cronToOnCalendar() conversion from cron to systemd calendar syntax
 * - generateServiceFile() and generateTimerFile() content generation
 * - servicePath() and timerPath() formatting
 *
 * No actual systemctl commands are run — this tests pure generation logic.
 */

import { describe, it, expect } from "vitest";
import {
  cronToOnCalendar,
  generateServiceFile,
  generateTimerFile,
  servicePath,
  timerPath,
} from "@/modules/scheduler/systemd";
import type { ScheduledJob, ExecutablePaths } from "@/modules/scheduler/types";
import { homedir } from "os";
import { join } from "path";

// --- Path helpers ---

describe("servicePath", () => {
  it("returns path in ~/.config/systemd/user/ with .service extension", () => {
    const path = servicePath("test-job");
    expect(path).toBe(join(homedir(), ".config", "systemd", "user", "runwrk-test-job.service"));
  });
});

describe("timerPath", () => {
  it("returns path in ~/.config/systemd/user/ with .timer extension", () => {
    const path = timerPath("test-job");
    expect(path).toBe(join(homedir(), ".config", "systemd", "user", "runwrk-test-job.timer"));
  });
});

// --- cronToOnCalendar ---

describe("cronToOnCalendar", () => {
  it("converts simple daily cron (0 9 * * *)", () => {
    const result = cronToOnCalendar("0 9 * * *");
    expect(result).toEqual(["*-*-* 9:0:00"]);
  });

  it("converts every-minute cron (* * * * *)", () => {
    const result = cronToOnCalendar("* * * * *");
    expect(result).toEqual(["*-*-* *:*:00"]);
  });

  it("converts multi-hour cron with commas (0 9,14,20 * * *)", () => {
    const result = cronToOnCalendar("0 9,14,20 * * *");
    // Comma-separated values are preserved in systemd syntax
    expect(result).toEqual(["*-*-* 9,14,20:0:00"]);
  });

  it("converts monthly cron (0 0 1 * *)", () => {
    const result = cronToOnCalendar("0 0 1 * *");
    expect(result).toEqual(["*-*-1 0:0:00"]);
  });

  it("converts specific date cron (0 12 15 6 *)", () => {
    const result = cronToOnCalendar("0 12 15 6 *");
    expect(result).toEqual(["*-6-15 12:0:00"]);
  });

  it("converts weekday cron (30 10 * * 1)", () => {
    const result = cronToOnCalendar("30 10 * * 1");
    // Weekday 1 = Monday
    expect(result).toEqual(["Mon *-*-* 10:30:00"]);
  });

  it("converts multiple weekdays (0 9 * * 1,3,5)", () => {
    const result = cronToOnCalendar("0 9 * * 1,3,5");
    expect(result).toEqual(["Mon,Wed,Fri *-*-* 9:0:00"]);
  });

  it("converts Sunday (weekday 0)", () => {
    const result = cronToOnCalendar("0 8 * * 0");
    expect(result).toEqual(["Sun *-*-* 8:0:00"]);
  });

  it("throws on invalid field count", () => {
    expect(() => cronToOnCalendar("0 9 * *")).toThrow(/expected 5 fields/);
  });

  it("throws on non-numeric values", () => {
    expect(() => cronToOnCalendar("abc 9 * * *")).toThrow(/Invalid cron value/);
  });

  it("throws on invalid weekday number", () => {
    expect(() => cronToOnCalendar("0 9 * * 8")).toThrow(/Invalid weekday/);
  });
});

// --- generateServiceFile ---

describe("generateServiceFile", () => {
  const mockJob: ScheduledJob = {
    name: "test-engage",
    command: "twitter -w growth",
    cron: "0 9 * * *",
    enabled: true,
    createdAt: "2026-01-15T12:00:00Z",
    description: "Run growth engagement daily",
  };

  const mockPaths: ExecutablePaths = {
    bunPath: "/usr/local/bin/bun",
    entryPath: "/home/user/runwrk/src/index.ts",
    projectRoot: "/home/user/runwrk",
    bunDir: "/usr/local/bin",
    logDir: "/home/user/runwrk/.runwrk/scheduler/logs",
  };

  it("generates valid INI-style service file", () => {
    const content = generateServiceFile(mockJob, mockPaths);

    expect(content).toContain("[Unit]");
    expect(content).toContain("[Service]");
    expect(content).toContain("Type=oneshot");
  });

  it("includes description from job", () => {
    const content = generateServiceFile(mockJob, mockPaths);
    expect(content).toContain("Description=RunWrk: Run growth engagement daily");
  });

  it("includes ExecStart with bun, entry point, and command", () => {
    const content = generateServiceFile(mockJob, mockPaths);
    expect(content).toContain(
      "ExecStart=/usr/local/bin/bun run /home/user/runwrk/src/index.ts twitter -w growth"
    );
  });

  it("includes working directory", () => {
    const content = generateServiceFile(mockJob, mockPaths);
    expect(content).toContain("WorkingDirectory=/home/user/runwrk");
  });

  it("includes log file paths with append mode", () => {
    const content = generateServiceFile(mockJob, mockPaths);
    expect(content).toContain("StandardOutput=append:");
    expect(content).toContain("test-engage.stdout.log");
    expect(content).toContain("StandardError=append:");
    expect(content).toContain("test-engage.stderr.log");
  });

  it("uses job name as fallback description when not provided", () => {
    const noDescJob: ScheduledJob = { ...mockJob, description: undefined };
    const content = generateServiceFile(noDescJob, mockPaths);
    expect(content).toContain("Description=RunWrk: RunWrk job: test-engage");
  });
});

// --- generateTimerFile ---

describe("generateTimerFile", () => {
  const mockJob: ScheduledJob = {
    name: "test-engage",
    command: "twitter -w growth",
    cron: "0 9 * * *",
    enabled: true,
    createdAt: "2026-01-15T12:00:00Z",
    description: "Run growth engagement daily",
  };

  it("generates valid INI-style timer file", () => {
    const content = generateTimerFile(mockJob);

    expect(content).toContain("[Unit]");
    expect(content).toContain("[Timer]");
    expect(content).toContain("[Install]");
    expect(content).toContain("WantedBy=timers.target");
  });

  it("includes OnCalendar line from cron conversion", () => {
    const content = generateTimerFile(mockJob);
    expect(content).toContain("OnCalendar=");
  });

  it("includes Persistent=true for missed-run recovery", () => {
    const content = generateTimerFile(mockJob);
    expect(content).toContain("Persistent=true");
  });

  it("includes description", () => {
    const content = generateTimerFile(mockJob);
    expect(content).toContain("Timer for RunWrk: Run growth engagement daily");
  });
});
