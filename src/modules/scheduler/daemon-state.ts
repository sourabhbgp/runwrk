// Daemon state persistence — tracks per-job last-run-at and exit codes in daemon-state.json

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getSchedulerDir, ensureSchedulerDir } from "./jobs";
import type { DaemonState, DaemonJobState } from "./types";

// --- Paths ---

/** Path to the daemon state file */
function statePath(): string {
  return join(getSchedulerDir(), "daemon-state.json");
}

// --- Read / Write ---

/** Read daemon state from disk. Returns a fresh empty state if file doesn't exist. */
export function readDaemonState(): DaemonState {
  const path = statePath();
  if (!existsSync(path)) {
    return { jobs: {}, startedAt: new Date().toISOString() };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as DaemonState;
}

/** Persist daemon state to disk (creates scheduler dir if needed) */
export function writeDaemonState(state: DaemonState): void {
  ensureSchedulerDir();
  writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
}

// --- Per-Job Helpers ---

/** Get the state entry for a job, creating a fresh one if it doesn't exist yet */
export function getJobState(state: DaemonState, name: string): DaemonJobState {
  if (!state.jobs[name]) {
    state.jobs[name] = {
      name,
      lastRunAt: null,
      lastExitCode: null,
      running: false,
    };
  }
  return state.jobs[name];
}

/** Merge updates into a job's state entry, persist to disk, and return the updated full state */
export function updateJobState(
  state: DaemonState,
  name: string,
  updates: Partial<Pick<DaemonJobState, "lastRunAt" | "lastExitCode" | "running">>
): DaemonState {
  const jobState = getJobState(state, name);
  Object.assign(jobState, updates);
  writeDaemonState(state);
  return state;
}
