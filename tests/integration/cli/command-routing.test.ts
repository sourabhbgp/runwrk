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
  it("myteam --help outputs root help text", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("myteam");
  });

  it("myteam --version outputs version number", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "--version"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("1.0.0");
  });

  it("myteam setup --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "setup", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Configure Anthropic API key");
  });

  it("myteam chat --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "chat", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("chat session");
  });

  it("myteam twitter --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Twitter engagement");
  });

  it("myteam twitter setup --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "setup", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("credentials");
  });

  it("myteam twitter stats --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "stats", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("analytics");
  });

  it("myteam twitter feedback --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "feedback", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("directives");
  });

  it("myteam twitter workflow --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "workflow", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("workflow");
  });

  it("myteam twitter workflow create --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "workflow", "create", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Create");
  });

  it("myteam twitter workflow list --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "workflow", "list", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("List");
  });

  it("myteam twitter workflow edit --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "workflow", "edit", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    expect(stripAnsi(output.stdout)).toContain("Edit");
  });

  it("myteam twitter workflow delete --help contains description", async () => {
    const { program, output } = createTestProgram();
    try {
      await program.parseAsync(["node", "myteam", "twitter", "workflow", "delete", "--help"]);
    } catch (e: unknown) {
      const err = e as { exitCode: number };
      expect(err.exitCode).toBe(0);
    }
    // Case-insensitive check: description may say "Permanently delete" or "delete"
    expect(stripAnsi(output.stdout).toLowerCase()).toContain("delete");
  });
});
