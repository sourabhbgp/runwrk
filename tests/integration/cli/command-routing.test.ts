/**
 * command-routing.test.ts — Verifies all registered CLI commands are routable.
 *
 * Each test invokes --help for a specific command/subcommand and asserts the
 * output contains the expected description text. This confirms Commander has
 * the command registered and wired up correctly without running real handlers.
 */

import { describe, it, expect } from "vitest";
import { createTestProgram } from "../../helpers/program-factory";
import { stripAnsi } from "../../helpers/strip";

describe("CLI command routing", () => {
  it("runwrk --help outputs root help text", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("runwrk");
  });

  it("runwrk --version outputs version number", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "--version"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("1.0.0");
  });

  it("runwrk setup --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "setup", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Configure Anthropic API key");
  });

  it("runwrk chat --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "chat", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("chat session");
  });

  it("runwrk twitter --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Twitter engagement");
  });

  it("runwrk twitter setup --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "setup", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("credentials");
  });

  it("runwrk twitter stats --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "stats", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("analytics");
  });

  it("runwrk twitter feedback --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "feedback", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("directives");
  });

  it("runwrk twitter workflow --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("workflow");
  });

  it("runwrk twitter workflow create --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "create", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Create");
  });

  it("runwrk twitter workflow list --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "list", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("List");
  });

  it("runwrk twitter workflow edit --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "edit", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Edit");
  });

  it("runwrk twitter workflow delete --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "runwrk", "twitter", "workflow", "delete", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    // Case-insensitive check: description may say "Permanently delete" or "delete"
    expect(stripAnsi(output.stdout).toLowerCase()).toContain("delete");
  });
});
