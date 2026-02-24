// Platform detection and delegation — routes scheduler operations to the correct OS backend

import { dirname, join, resolve } from "path";
import type { ScheduledJob, JobStatus, Platform, ExecutablePaths } from "./types";
import { getJob, getLogsDir } from "./jobs";
import {
  installLaunchd,
  uninstallLaunchd,
  isLaunchdInstalled,
  getLaunchdStatus,
} from "./launchd";
import {
  installSystemd,
  uninstallSystemd,
  isSystemdInstalled,
  getSystemdStatus,
} from "./systemd";
import { getLastRunTimestamp } from "./logs";

// --- Platform Detection ---

/** Detect the current platform, throwing on unsupported OS */
export function detectPlatform(): Platform {
  const p = process.platform;
  if (p === "darwin" || p === "linux") return p;
  throw new Error(`Unsupported platform: "${p}". Only macOS (launchd) and Linux (systemd) are supported.`);
}

// --- Executable Paths ---

/** Resolve absolute paths to bun, the CLI entry point, project root, and log dir */
export function resolveExecutablePaths(): ExecutablePaths {
  const bunPath = process.execPath;
  const bunDir = dirname(bunPath);

  // The entry point is src/index.ts relative to the project root
  const projectRoot = process.cwd();
  const entryPath = resolve(projectRoot, "src", "index.ts");
  const logDir = getLogsDir();

  return { bunPath, entryPath, projectRoot, bunDir, logDir };
}

// --- Delegated Operations ---

/** Install an OS-level timer for a scheduled job */
export function installJob(job: ScheduledJob): void {
  const platform = detectPlatform();
  const paths = resolveExecutablePaths();

  if (platform === "darwin") {
    installLaunchd(job, paths);
  } else {
    installSystemd(job, paths);
  }
}

/** Uninstall the OS-level timer for a job */
export function uninstallJob(name: string): void {
  const platform = detectPlatform();

  if (platform === "darwin") {
    uninstallLaunchd(name);
  } else {
    uninstallSystemd(name);
  }
}

/** Check if the OS-level timer is installed for a job */
export function isInstalled(name: string): boolean {
  const platform = detectPlatform();

  if (platform === "darwin") {
    return isLaunchdInstalled(name);
  } else {
    return isSystemdInstalled(name);
  }
}

/** Get the full status of a scheduled job (registry + OS state + logs) */
export function getJobStatus(name: string): JobStatus | null {
  const job = getJob(name);
  if (!job) return null;

  const platform = detectPlatform();
  const installed = isInstalled(name);

  let lastExitCode: number | null = null;
  let nextRun: string | null = null;

  if (platform === "darwin") {
    const status = getLaunchdStatus(name);
    if (status) {
      lastExitCode = status.lastExitCode;
    }
  } else {
    const status = getSystemdStatus(name);
    if (status) {
      lastExitCode = status.lastExitCode;
      nextRun = status.nextRun;
    }
  }

  const lastRun = getLastRunTimestamp(name);

  return {
    job,
    installed,
    nextRun: nextRun ?? undefined,
    lastRun: lastRun ?? undefined,
    lastExitCode: lastExitCode ?? undefined,
  };
}
