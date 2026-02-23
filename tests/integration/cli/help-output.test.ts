/**
 * help-output.test.ts — Snapshot tests for CLI help output.
 *
 * Captures ANSI-stripped help text and compares against stored snapshots.
 * If help text changes intentionally, update snapshots with `vitest -u`.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("CLI help output snapshots", () => {
  it("root help output matches snapshot", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "--help"]);
    } catch {
      // --help throws CommanderError with exitCode 0
    }
    expect(stripAnsi(output.stdout)).toMatchSnapshot();
  });

  it("twitter help output matches snapshot", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "--help"]);
    } catch {
      // --help throws CommanderError with exitCode 0
    }
    expect(stripAnsi(output.stdout)).toMatchSnapshot();
  });

  it("twitter workflow help output matches snapshot", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "workflow", "--help"]);
    } catch {
      // --help throws CommanderError with exitCode 0
    }
    expect(stripAnsi(output.stdout)).toMatchSnapshot();
  });
});
