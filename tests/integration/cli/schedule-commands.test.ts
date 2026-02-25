/**
 * schedule-commands.test.ts — CLI integration tests for `runwrk schedule` commands.
 *
 * Verifies command routing and help output for all schedule subcommands.
 * Uses createTestProgram() for output capture and exitOverride.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("CLI schedule command routing", () => {
  it("runwrk schedule --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("scheduled jobs");
  });

  it("runwrk schedule add --help shows required options", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "add", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("--name");
    expect(text).toContain("--command");
    expect(text).toContain("--cron");
  });

  it("runwrk schedule remove --help shows name argument", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "remove", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
  });

  it("runwrk schedule list --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "list", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("List");
  });

  it("runwrk schedule enable --help shows name argument", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "enable", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
    expect(text).toContain("enable");
  });

  it("runwrk schedule disable --help shows name argument", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "disable", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
  });

  it("runwrk schedule logs --help shows name argument and options", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "schedule", "logs", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
    expect(text).toContain("--lines");
    expect(text).toContain("--clear");
  });

  it("root help text includes Scheduler section", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("Scheduler");
    expect(text).toContain("schedule add");
    expect(text).toContain("schedule list");
  });
});
