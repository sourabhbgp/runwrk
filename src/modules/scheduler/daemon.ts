// Daemon backend — in-process timer loop for running scheduled jobs inside Docker.
// Replaces systemd/launchd when MYTEAM_DAEMON=1. Uses croner for cron expression parsing.

import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { resolve, join } from "path";
import { Cron } from "croner";
import type { ScheduledJob, JobStatus } from "./types";
import { getJob, listJobs, getLogsDir, ensureSchedulerDir } from "./jobs";
import {
  readDaemonState,
  writeDaemonState,
  getJobState,
  updateJobState,
} from "./daemon-state";

// --- Configuration ---

/** Options for the daemon loop */
export interface DaemonConfig {
  /** Maximum number of jobs running concurrently (default: 3) */
  maxConcurrent?: number;
  /** Tick interval in milliseconds (default: 60000). Override for testing. */
  tickIntervalMs?: number;
  /** AbortSignal for graceful shutdown (e.g. from SIGTERM/SIGINT) */
  signal?: AbortSignal;
}

// --- Backend Interface (matches launchd/systemd pattern) ---

/** No-op — the daemon reads jobs.json directly on each tick */
export function installDaemon(_job: ScheduledJob): void {
  // Intentionally empty: daemon discovers jobs from jobs.json
}

/** No-op — the daemon picks up job removal on the next tick */
export function uninstallDaemon(_name: string): void {
  // Intentionally empty: daemon stops running removed jobs automatically
}

/** A job is "installed" in daemon mode if it exists in the registry */
export function isDaemonInstalled(name: string): boolean {
  return getJob(name) !== null;
}

/** Get status for a job in daemon mode — computes nextRun via croner, reads state from daemon-state.json */
export function getDaemonStatus(name: string): {
  nextRun: string | null;
  lastExitCode: number | null;
} | null {
  const job = getJob(name);
  if (!job) return null;

  const state = readDaemonState();
  const jobState = getJobState(state, name);

  // Compute next run time from cron expression
  let nextRun: string | null = null;
  try {
    const cron = new Cron(job.cron, { timezone: job.timezone });
    const next = cron.nextRun();
    if (next) nextRun = next.toISOString();
  } catch {
    // Invalid cron — leave nextRun as null
  }

  return {
    nextRun,
    lastExitCode: jobState.lastExitCode,
  };
}

// --- Job Execution ---

/** Check if a job is due to run based on its cron schedule and last run time */
export function isJobDue(job: ScheduledJob, lastRunAt: string | null, now: Date): boolean {
  try {
    const cron = new Cron(job.cron, { timezone: job.timezone });

    if (!lastRunAt) {
      // Never run before — check if any cron window has passed since epoch
      // Fire once on first encounter
      return true;
    }

    const lastRun = new Date(lastRunAt);
    // Get the next run time after the last run
    const nextAfterLast = cron.nextRun(lastRun);
    if (!nextAfterLast) return false;

    // Job is due if the next scheduled time after the last run is at or before now
    return nextAfterLast.getTime() <= now.getTime();
  } catch {
    // Invalid cron expression — skip this job
    return false;
  }
}

/** Spawn a job command and stream output to log files. Returns a promise that resolves with exit code. */
function executeJob(job: ScheduledJob): Promise<number> {
  return new Promise((resolvePromise) => {
    ensureSchedulerDir();
    const logDir = getLogsDir();

    const stdoutLog = createWriteStream(join(logDir, `${job.name}.stdout.log`), { flags: "a" });
    const stderrLog = createWriteStream(join(logDir, `${job.name}.stderr.log`), { flags: "a" });

    // Write a timestamp header for this run
    const header = `\n--- [${new Date().toISOString()}] ---\n`;
    stdoutLog.write(header);
    stderrLog.write(header);

    // Spawn: bun run src/index.ts <command args>
    const entryPath = resolve(process.cwd(), "src", "index.ts");
    const args = ["run", entryPath, ...job.command.split(/\s+/)];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.pipe(stdoutLog);
    child.stderr.pipe(stderrLog);

    child.on("close", (code) => {
      stdoutLog.end();
      stderrLog.end();
      resolvePromise(code ?? 1);
    });

    child.on("error", (err) => {
      stderrLog.write(`spawn error: ${err.message}\n`);
      stdoutLog.end();
      stderrLog.end();
      resolvePromise(1);
    });
  });
}

// --- Daemon Loop ---

/** Start the daemon loop — wakes on each tick, checks for due jobs, and executes them */
export async function startDaemon(config: DaemonConfig = {}): Promise<void> {
  const {
    maxConcurrent = 3,
    tickIntervalMs = 60_000,
    signal,
  } = config;

  // Initialize daemon state with current timestamp
  const state = readDaemonState();
  state.startedAt = new Date().toISOString();
  writeDaemonState(state);

  console.log(`[daemon] Started at ${state.startedAt}`);
  console.log(`[daemon] Tick interval: ${tickIntervalMs}ms, max concurrent: ${maxConcurrent}`);

  // Track currently running job names to enforce concurrency and prevent duplicate runs
  const running = new Set<string>();

  /** Process a single tick: check all enabled jobs and fire due ones */
  async function tick(): Promise<void> {
    const now = new Date();
    const currentState = readDaemonState();
    const jobs = listJobs().filter((j) => j.enabled);

    console.log(`[daemon] Tick at ${now.toISOString()} — ${jobs.length} enabled job(s)`);

    for (const job of jobs) {
      // Skip if already running or at concurrency limit
      if (running.has(job.name)) continue;
      if (running.size >= maxConcurrent) break;

      const jobState = getJobState(currentState, job.name);
      if (!isJobDue(job, jobState.lastRunAt, now)) continue;

      // Mark as running and execute
      running.add(job.name);
      updateJobState(currentState, job.name, { running: true });
      console.log(`[daemon] Starting job: ${job.name} (command: ${job.command})`);

      // Execute asynchronously — don't block the tick for other jobs
      executeJob(job).then((exitCode) => {
        running.delete(job.name);
        const freshState = readDaemonState();
        updateJobState(freshState, job.name, {
          lastRunAt: new Date().toISOString(),
          lastExitCode: exitCode,
          running: false,
        });
        console.log(`[daemon] Job "${job.name}" finished with exit code ${exitCode}`);
      });
    }
  }

  // Run the first tick immediately
  await tick();

  // Then loop on the interval until abort signal fires
  while (!signal?.aborted) {
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(), tickIntervalMs);

      // If abort signal fires before the timer, clear it and resolve immediately
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          resolvePromise();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    if (signal?.aborted) break;
    await tick();
  }

  console.log("[daemon] Shutting down gracefully...");

  // Wait for running jobs to finish (with a 30s timeout)
  if (running.size > 0) {
    console.log(`[daemon] Waiting for ${running.size} running job(s) to finish...`);
    const deadline = Date.now() + 30_000;
    while (running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (running.size > 0) {
      console.log(`[daemon] Timed out waiting for ${running.size} job(s)`);
    }
  }

  console.log("[daemon] Stopped.");
}
