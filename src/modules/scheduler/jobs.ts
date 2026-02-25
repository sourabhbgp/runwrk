// Job registry — CRUD operations on .runwrk/scheduler/jobs.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ScheduledJob } from "./types";

// --- Paths ---

/** Base directory for scheduler data */
function schedulerDir(): string {
  return join(process.cwd(), ".runwrk", "scheduler");
}

/** Path to the jobs registry file */
function jobsFilePath(): string {
  return join(schedulerDir(), "jobs.json");
}

/** Path to the logs directory */
function logsDir(): string {
  return join(schedulerDir(), "logs");
}

// --- Directory Setup ---

/** Ensure .runwrk/scheduler/ and logs/ directories exist */
export function ensureSchedulerDir(): void {
  mkdirSync(logsDir(), { recursive: true });
}

/** Get the absolute path to the scheduler logs directory */
export function getLogsDir(): string {
  return logsDir();
}

/** Get the absolute path to the scheduler directory */
export function getSchedulerDir(): string {
  return schedulerDir();
}

// --- Registry I/O ---

/** Read all jobs from the registry file. Returns empty array if file doesn't exist. */
function readRegistry(): ScheduledJob[] {
  const path = jobsFilePath();
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as ScheduledJob[];
}

/** Write the full job list back to the registry file */
function writeRegistry(jobs: ScheduledJob[]): void {
  ensureSchedulerDir();
  writeFileSync(jobsFilePath(), JSON.stringify(jobs, null, 2), "utf-8");
}

// --- CRUD Operations ---

/** List all registered jobs */
export function listJobs(): ScheduledJob[] {
  return readRegistry();
}

/** Find a job by name, or null if not found */
export function getJob(name: string): ScheduledJob | null {
  const jobs = readRegistry();
  return jobs.find((j) => j.name === name) ?? null;
}

/** Add a new job to the registry. Throws if a job with the same name already exists. */
export function addJob(
  job: Omit<ScheduledJob, "createdAt" | "enabled">
): ScheduledJob {
  const jobs = readRegistry();

  if (jobs.some((j) => j.name === job.name)) {
    throw new Error(`Job "${job.name}" already exists. Remove it first or choose a different name.`);
  }

  const newJob: ScheduledJob = {
    ...job,
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  jobs.push(newJob);
  writeRegistry(jobs);
  return newJob;
}

/** Remove a job from the registry by name. Returns true if found and removed. */
export function removeJob(name: string): boolean {
  const jobs = readRegistry();
  const idx = jobs.findIndex((j) => j.name === name);
  if (idx === -1) return false;

  jobs.splice(idx, 1);
  writeRegistry(jobs);
  return true;
}

/** Update fields on an existing job. Throws if job not found. Returns the updated job. */
export function updateJob(
  name: string,
  updates: Partial<Pick<ScheduledJob, "enabled" | "command" | "cron" | "timezone" | "description">>
): ScheduledJob {
  const jobs = readRegistry();
  const idx = jobs.findIndex((j) => j.name === name);

  if (idx === -1) {
    throw new Error(`Job "${name}" not found.`);
  }

  jobs[idx] = { ...jobs[idx], ...updates };
  writeRegistry(jobs);
  return jobs[idx];
}
