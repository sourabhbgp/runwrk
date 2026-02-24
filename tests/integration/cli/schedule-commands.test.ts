/**
 * schedule-commands.test.ts — CLI integration tests for `myteam schedule` commands.
 *
 * Verifies command routing and help output for all schedule subcommands.
 * Uses createTestProgram() for output capture and exitOverride.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("CLI schedule command routing", () => {
  it("myteam schedule --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("scheduled jobs");
  });

  it("myteam schedule add --help shows required options", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "add", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("--name");
    expect(text).toContain("--command");
    expect(text).toContain("--cron");
  });

  it("myteam schedule remove --help shows name argument", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "remove", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
  });

  it("myteam schedule list --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "list", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("List");
  });

  it("myteam schedule enable --help shows name argument", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "enable", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
    expect(text).toContain("enable");
  });

  it("myteam schedule disable --help shows name argument", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "disable", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("name");
  });

  it("myteam schedule logs --help shows name argument and options", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "schedule", "logs", "--help"]);
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
      await program.parseAsync(["node", "myteam", "--help"]);
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
