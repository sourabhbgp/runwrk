// Type definitions for the generic OS-level job scheduler

// --- Job Definition ---

/** A scheduled job that runs a CLI command on a cron schedule via OS timers */
export interface ScheduledJob {
  /** Unique identifier (e.g. "growth-engage", "growth-consolidate") */
  name: string;
  /** CLI command to run, without the `myteam` prefix (e.g. "twitter -w growth") */
  command: string;
  /** Cron expression (e.g. "0 9,14,20 * * *") — standard 5-field format */
  cron: string;
  /** IANA timezone (e.g. "America/New_York"). Defaults to system timezone. */
  timezone?: string;
  /** Whether the job is active. Allows pausing without removing. */
  enabled: boolean;
  /** ISO timestamp of when the job was created */
  createdAt: string;
  /** Human-readable description of what this job does */
  description?: string;
}

// --- Job Status ---

/** Runtime status of a scheduled job, combining registry data with OS timer state */
export interface JobStatus {
  /** The job definition from the registry */
  job: ScheduledJob;
  /** Whether the OS-level timer is currently installed */
  installed: boolean;
  /** Next scheduled run time (from OS), if available */
  nextRun?: string;
  /** Last run timestamp (from log files), if available */
  lastRun?: string;
  /** Exit code of the most recent run, if available */
  lastExitCode?: number;
}

// --- Platform ---

/** Supported platforms for OS-level scheduling */
export type Platform = "darwin" | "linux" | "daemon";

// --- Daemon State ---

/** Per-job state tracked by the in-process daemon scheduler */
export interface DaemonJobState {
  /** Job name (matches ScheduledJob.name) */
  name: string;
  /** ISO timestamp of the last completed run, or null if never run */
  lastRunAt: string | null;
  /** Exit code of the most recent run, or null if never run */
  lastExitCode: number | null;
  /** Whether the job is currently executing */
  running: boolean;
}

/** Persisted state for the daemon scheduler */
export interface DaemonState {
  /** Per-job state, keyed by job name */
  jobs: Record<string, DaemonJobState>;
  /** ISO timestamp of when the daemon was started */
  startedAt: string;
}

/** Resolved paths needed to generate OS timer configurations */
export interface ExecutablePaths {
  /** Absolute path to the bun binary */
  bunPath: string;
  /** Absolute path to the CLI entry point (src/index.ts) */
  entryPath: string;
  /** Absolute path to the project root (working directory for jobs) */
  projectRoot: string;
  /** Directory containing the bun binary (for PATH injection) */
  bunDir: string;
  /** Absolute path to the scheduler logs directory */
  logDir: string;
}
