/**
 * launchd.test.ts — Tests for macOS launchd plist generation and cron conversion.
 *
 * Tests cover:
 * - cronToCalendarIntervals() conversion from cron expressions to launchd dicts
 * - generatePlist() XML output with correct structure and values
 * - jobLabel() and plistPath() formatting
 *
 * No actual launchctl commands are run — this tests pure generation logic.
 */

import { describe, it, expect } from "vitest";
import {
  cronToCalendarIntervals,
  generatePlist,
  jobLabel,
  plistPath,
} from "@/modules/scheduler/launchd";
import type { ScheduledJob, ExecutablePaths } from "@/modules/scheduler/types";
import { homedir } from "os";
import { join } from "path";

// --- jobLabel ---

describe("jobLabel", () => {
  it("prefixes job name with com.runwrk.", () => {
    expect(jobLabel("growth-engage")).toBe("com.runwrk.growth-engage");
  });
});

// --- plistPath ---

describe("plistPath", () => {
  it("returns path in ~/Library/LaunchAgents/", () => {
    const path = plistPath("test-job");
    expect(path).toBe(join(homedir(), "Library", "LaunchAgents", "com.runwrk.test-job.plist"));
  });
});

// --- cronToCalendarIntervals ---

describe("cronToCalendarIntervals", () => {
  it("converts simple daily cron (0 9 * * *)", () => {
    const result = cronToCalendarIntervals("0 9 * * *");
    expect(result).toEqual([{ Minute: 0, Hour: 9 }]);
  });

  it("converts every-minute cron (* * * * *)", () => {
    const result = cronToCalendarIntervals("* * * * *");
    // All wildcards → single empty dict (launchd runs every minute)
    expect(result).toEqual([{}]);
  });

  it("converts multi-hour cron (0 9,14,20 * * *)", () => {
    const result = cronToCalendarIntervals("0 9,14,20 * * *");
    expect(result).toEqual([
      { Minute: 0, Hour: 9 },
      { Minute: 0, Hour: 14 },
      { Minute: 0, Hour: 20 },
    ]);
  });

  it("converts weekday cron (30 10 * * 1,3,5)", () => {
    const result = cronToCalendarIntervals("30 10 * * 1,3,5");
    expect(result).toEqual([
      { Minute: 30, Hour: 10, Weekday: 1 },
      { Minute: 30, Hour: 10, Weekday: 3 },
      { Minute: 30, Hour: 10, Weekday: 5 },
    ]);
  });

  it("converts monthly cron (0 0 1 * *)", () => {
    const result = cronToCalendarIntervals("0 0 1 * *");
    expect(result).toEqual([{ Minute: 0, Hour: 0, Day: 1 }]);
  });

  it("converts fully-specified cron (0 12 15 6 *)", () => {
    const result = cronToCalendarIntervals("0 12 15 6 *");
    expect(result).toEqual([{ Minute: 0, Hour: 12, Day: 15, Month: 6 }]);
  });

  it("creates cartesian product for multi-value fields", () => {
    // Two minutes × two hours → 4 entries
    const result = cronToCalendarIntervals("0,30 9,14 * * *");
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ Minute: 0, Hour: 9 });
    expect(result).toContainEqual({ Minute: 0, Hour: 14 });
    expect(result).toContainEqual({ Minute: 30, Hour: 9 });
    expect(result).toContainEqual({ Minute: 30, Hour: 14 });
  });

  it("throws on invalid field count", () => {
    expect(() => cronToCalendarIntervals("0 9 * *")).toThrow(/expected 5 fields/);
    expect(() => cronToCalendarIntervals("0 9 * * * *")).toThrow(/expected 5 fields/);
  });

  it("throws on non-numeric values", () => {
    expect(() => cronToCalendarIntervals("abc 9 * * *")).toThrow(/Invalid cron value/);
  });
});

// --- generatePlist ---

describe("generatePlist", () => {
  const mockJob: ScheduledJob = {
    name: "test-engage",
    command: "twitter -w growth",
    cron: "0 9,14 * * *",
    enabled: true,
    createdAt: "2026-01-15T12:00:00Z",
    description: "Run growth engagement twice daily",
  };

  const mockPaths: ExecutablePaths = {
    bunPath: "/usr/local/bin/bun",
    entryPath: "/home/user/runwrk/src/index.ts",
    projectRoot: "/home/user/runwrk",
    bunDir: "/usr/local/bin",
    logDir: "/home/user/runwrk/.runwrk/scheduler/logs",
  };

  it("generates valid XML plist structure", () => {
    const xml = generatePlist(mockJob, mockPaths);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<!DOCTYPE plist");
    expect(xml).toContain('<plist version="1.0">');
    expect(xml).toContain("</plist>");
  });

  it("includes correct label", () => {
    const xml = generatePlist(mockJob, mockPaths);
    expect(xml).toContain("<string>com.runwrk.test-engage</string>");
  });

  it("includes ProgramArguments with bun, run, entry point, and command args", () => {
    const xml = generatePlist(mockJob, mockPaths);

    expect(xml).toContain("<string>/usr/local/bin/bun</string>");
    expect(xml).toContain("<string>run</string>");
    expect(xml).toContain("<string>/home/user/runwrk/src/index.ts</string>");
    expect(xml).toContain("<string>twitter</string>");
    expect(xml).toContain("<string>-w</string>");
    expect(xml).toContain("<string>growth</string>");
  });

  it("includes log file paths", () => {
    const xml = generatePlist(mockJob, mockPaths);

    expect(xml).toContain("test-engage.stdout.log");
    expect(xml).toContain("test-engage.stderr.log");
  });

  it("includes working directory", () => {
    const xml = generatePlist(mockJob, mockPaths);
    expect(xml).toContain("<string>/home/user/runwrk</string>");
  });

  it("includes PATH environment variable with bun directory", () => {
    const xml = generatePlist(mockJob, mockPaths);
    expect(xml).toContain("/usr/local/bin");
  });

  it("uses array for multiple calendar intervals", () => {
    const xml = generatePlist(mockJob, mockPaths);
    // Two hours (9,14) → should have <array> with two <dict> entries
    expect(xml).toContain("<key>StartCalendarInterval</key>");
    expect(xml).toContain("<array>");

    // Check both intervals present
    const hourMatches = xml.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/g);
    expect(hourMatches).toHaveLength(2);
  });

  it("uses single dict (no array) for single calendar interval", () => {
    const singleJob: ScheduledJob = { ...mockJob, cron: "0 9 * * *" };
    const xml = generatePlist(singleJob, mockPaths);

    expect(xml).toContain("<key>StartCalendarInterval</key>");
    // Should NOT have <array> wrapping the single dict
    expect(xml).not.toMatch(/<key>StartCalendarInterval<\/key>\s*<array>/);
  });

  it("escapes XML special characters in paths", () => {
    const specialPaths: ExecutablePaths = {
      ...mockPaths,
      projectRoot: "/home/user/my&team",
    };
    const xml = generatePlist(mockJob, specialPaths);
    expect(xml).toContain("my&amp;team");
  });
});
