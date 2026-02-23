/**
 * cli-smoke.test.ts — Spawns the actual CLI binary via `bun run` and checks
 * exit codes and output for basic sanity. These are true end-to-end tests
 * that exercise the full startup path including module resolution.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

const CLI_PATH = join(process.cwd(), "src/index.ts");

/** Run the CLI with given args, returning stdout and exit code */
function runCli(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`bun run ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      timeout: 10000,
      // Prevent inheriting test process env that might interfere
      env: { ...process.env, NODE_ENV: "test" },
    });
    return { stdout, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

describe("CLI smoke tests (spawned process)", () => {
  it("--help exits with code 0 and output contains 'myteam'", () => {
    const { stdout, exitCode } = runCli("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("myteam");
  });

  it("--version exits with code 0 and output contains '1.0.0'", () => {
    const { stdout, exitCode } = runCli("--version");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1.0.0");
  });

  it("unknown command exits with code 1", () => {
    const { exitCode } = runCli("nonexistent");
    expect(exitCode).toBe(1);
  });

  it("twitter --help exits with code 0 and contains 'Twitter'", () => {
    const { stdout, exitCode } = runCli("twitter --help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Twitter");
  });

  it("setup --help exits with code 0 and contains 'API key'", () => {
    const { stdout, exitCode } = runCli("setup --help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("API key");
  });
});
