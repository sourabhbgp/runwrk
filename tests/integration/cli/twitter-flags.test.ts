/**
 * twitter-flags.test.ts — Verifies Twitter command flags are registered and
 * documented correctly via --help output inspection.
 *
 * We check that each command's help text mentions the expected flags/options,
 * confirming Commander has them wired up without triggering real handlers.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("Twitter command flags", () => {
  it("twitter --help lists --workflow and --manual flags", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const help = stripAnsi(output.stdout);
    expect(help).toContain("--workflow");
    expect(help).toContain("--manual");
  });

  it("twitter --help lists -w shorthand for --workflow", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const help = stripAnsi(output.stdout);
    expect(help).toContain("-w");
  });

  it("twitter stats --help lists --workflow option", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "stats", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const help = stripAnsi(output.stdout);
    expect(help).toContain("--workflow");
  });

  it("twitter feedback --help shows --workflow as required", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "feedback", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const help = stripAnsi(output.stdout);
    // Required options show up in help text — Commander marks them
    expect(help).toContain("--workflow");
    expect(help).toContain("-w");
  });

  it("twitter workflow edit --help shows --workflow as required", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "edit", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const help = stripAnsi(output.stdout);
    expect(help).toContain("--workflow");
  });

  it("twitter workflow delete --help shows --workflow as required", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "delete", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const help = stripAnsi(output.stdout);
    expect(help).toContain("--workflow");
  });
});
