/**
 * daemon-command.test.ts — CLI integration tests for `runwrk daemon`.
 *
 * Verifies command registration, help output, and flag parsing.
 * Uses createTestProgram() for output capture and exitOverride.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("CLI daemon command", () => {
  it("runwrk daemon --help exits with code 0 and shows description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "daemon", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("daemon");
    expect(text).toContain("Docker");
  });

  it("runwrk daemon --help shows --max-concurrent option", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "daemon", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("--max-concurrent");
  });

  it("root help text includes Daemon section", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    const text = stripAnsi(output.stdout);
    expect(text).toContain("Daemon");
    expect(text).toContain("daemon");
  });
});
