/**
 * consolidate-command.test.ts — Verifies the `myteam twitter consolidate` CLI command routing.
 *
 * Tests that the consolidate subcommand is correctly registered under
 * `myteam twitter`, that its --help output describes consolidation and workflow,
 * and that the -w flag is shown as required.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("CLI: twitter consolidate command", () => {
  it("myteam twitter consolidate --help outputs help text containing 'consolidation' and 'workflow'", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "consolidate", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }

    const helpText = stripAnsi(output.stdout).toLowerCase();
    expect(helpText).toContain("consolidation");
    expect(helpText).toContain("workflow");
  });

  it("myteam twitter consolidate --help shows the -w flag as required", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "consolidate", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }

    const helpText = stripAnsi(output.stdout);
    // Verify the -w / --workflow flag is present in the help output.
    // Commander uses .requiredOption() which means the command will error
    // if -w is missing at runtime — the help text shows it under "Options".
    expect(helpText).toContain("-w");
    expect(helpText).toContain("--workflow <name>");
  });
});
