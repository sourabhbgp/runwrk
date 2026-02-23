/**
 * fixtures.ts — Temp directory management for filesystem tests.
 *
 * Creates an isolated workspace with .myteam/workflows/ structure.
 * Tests use process.chdir() to switch into the temp dir, then cleanup()
 * removes it and restores the original cwd.
 */

import { mkdirSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** An isolated test workspace with .myteam directory structure */
export interface TestWorkspace {
  /** Root of the temp directory */
  root: string;
  /** Path to .myteam/ */
  myteamDir: string;
  /** Path to .myteam/workflows/ */
  workflowsDir: string;
  /** Restore original cwd and remove the temp directory */
  cleanup: () => void;
}

/** Create a temp directory with .myteam/workflows/ structure and chdir into it.
 *  Returns paths and a cleanup function for use in afterEach. */
export function createTestWorkspace(): TestWorkspace {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), "myteam-test-"));
  const myteamDir = join(root, ".myteam");
  const workflowsDir = join(myteamDir, "workflows");

  mkdirSync(workflowsDir, { recursive: true });
  process.chdir(root);

  return {
    root,
    myteamDir,
    workflowsDir,
    cleanup: () => {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
