/**
 * program-factory.ts — Creates a fresh Commander program for integration tests.
 *
 * Each test gets an isolated program with `.exitOverride()` (throws instead of
 * process.exit) and `.configureOutput()` (captures stdout/stderr into strings).
 *
 * Commander v14 does NOT propagate exitOverride/configureOutput to subcommands,
 * so we recursively apply them to every registered command.
 */

import { Command } from "commander";
import { buildProgram } from "@/cli";

/** Captured output from a test program run */
export interface ProgramOutput {
  stdout: string;
  stderr: string;
}

/** Recursively apply exitOverride and configureOutput to a command and all its subcommands */
function applyOverrides(cmd: Command, output: ProgramOutput): void {
  cmd.exitOverride();
  cmd.configureOutput({
    writeOut: (str) => { output.stdout += str; },
    writeErr: (str) => { output.stderr += str; },
  });
  for (const sub of cmd.commands) {
    applyOverrides(sub as Command, output);
  }
}

/** Create a fresh Commander program that throws on exit and captures output */
export function createTestProgram(): { program: Command; output: ProgramOutput } {
  const output: ProgramOutput = { stdout: "", stderr: "" };

  const program = buildProgram();

  // Apply exitOverride and output capture to all commands recursively
  applyOverrides(program, output);

  return { program, output };
}
