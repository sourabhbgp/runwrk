// Daemon backend — in-process timer loop for running scheduled jobs inside Docker.
// Replaces systemd/launchd when MYTEAM_DAEMON=1. Uses croner for cron expression parsing.
// All output is structured via pino for Docker log capture and JSONL persistence.

import { spawn } from "child_process";
import { createWriteStream, writeFileSync } from "fs";
import { resolve, join } from "path";
import { Cron } from "croner";
import { getLogger } from "../../common";
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

// --- Health Check ---

/** Path to the daemon health check file (read by Docker HEALTHCHECK) */
function healthPath(): string {
  return join(process.cwd(), ".myteam", "daemon-health.json");
}

/** Write a health check file with current daemon status — read by Docker HEALTHCHECK */
function writeHealthCheck(status: string, upSince: string, runningJobs: number, enabledJobs: number): void {
  try {
    const health = {
      status,
      lastTick: new Date().toISOString(),
      upSince,
      runningJobs,
      enabledJobs,
    };
    writeFileSync(healthPath(), JSON.stringify(health, null, 2), "utf-8");
  } catch {
    // Non-critical — don't crash the daemon over a health file write failure
  }
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
function executeJob(job: ScheduledJob): Promise<{ exitCode: number; durationMs: number }> {
  const startTime = Date.now();
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
      resolvePromise({ exitCode: code ?? 1, durationMs: Date.now() - startTime });
    });

    child.on("error", (err) => {
      const log = getLogger().child({ component: "daemon", job: job.name });
      log.error({ err }, "Job spawn error");
      stderrLog.write(`spawn error: ${err.message}\n`);
      stdoutLog.end();
      stderrLog.end();
      resolvePromise({ exitCode: 1, durationMs: Date.now() - startTime });
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

  const log = getLogger().child({ component: "daemon" });

  // Initialize daemon state with current timestamp
  const state = readDaemonState();
  state.startedAt = new Date().toISOString();
  writeDaemonState(state);

  log.info({ startedAt: state.startedAt, tickIntervalMs, maxConcurrent }, "Started");

  // Track currently running job names to enforce concurrency and prevent duplicate runs
  const running = new Set<string>();

  /** Process a single tick: check all enabled jobs and fire due ones */
  async function tick(): Promise<void> {
    const now = new Date();
    const currentState = readDaemonState();
    const jobs = listJobs().filter((j) => j.enabled);

    log.info({ enabledJobs: jobs.length }, "Tick");

    // Write health check file for Docker HEALTHCHECK
    writeHealthCheck("ok", state.startedAt, running.size, jobs.length);

    for (const job of jobs) {
      // Skip if already running
      if (running.has(job.name)) continue;

      // Log when concurrency limit prevents a job from starting
      if (running.size >= maxConcurrent) {
        log.warn({ job: job.name, running: running.size, maxConcurrent }, "Concurrency limit reached, deferring job");
        break;
      }

      const jobState = getJobState(currentState, job.name);
      if (!isJobDue(job, jobState.lastRunAt, now)) continue;

      // Mark as running and execute
      running.add(job.name);
      updateJobState(currentState, job.name, { running: true });
      log.info({ job: job.name, command: job.command }, "Starting job");

      // Execute asynchronously — don't block the tick for other jobs
      executeJob(job).then(({ exitCode, durationMs }) => {
        running.delete(job.name);
        const freshState = readDaemonState();
        updateJobState(freshState, job.name, {
          lastRunAt: new Date().toISOString(),
          lastExitCode: exitCode,
          lastDurationMs: durationMs,
          running: false,
        });
        log.info({ job: job.name, exitCode, durationMs }, "Job finished");
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

  log.info("Shutting down gracefully...");

  // Wait for running jobs to finish (with a 30s timeout)
  if (running.size > 0) {
    log.info({ runningJobs: running.size }, "Waiting for running jobs to finish...");
    const deadline = Date.now() + 30_000;
    while (running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (running.size > 0) {
      log.warn({ runningJobs: running.size }, "Timed out waiting for jobs");
    }
  }

  // Write final health status
  writeHealthCheck("stopped", state.startedAt, 0, 0);
  log.info("Stopped.");
}
