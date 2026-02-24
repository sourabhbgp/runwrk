// Log reading and management for scheduled job output

import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getLogsDir, ensureSchedulerDir } from "./jobs";

// --- Paths ---

/** Get the stdout log path for a job */
function stdoutPath(name: string): string {
  return join(getLogsDir(), `${name}.stdout.log`);
}

/** Get the stderr log path for a job */
function stderrPath(name: string): string {
  return join(getLogsDir(), `${name}.stderr.log`);
}

// --- Reading ---

/** Read the last N lines from a file, or empty string if file doesn't exist */
function tailFile(path: string, lines: number): string {
  if (!existsSync(path)) return "";
  const content = readFileSync(path, "utf-8");
  const allLines = content.split("\n");

  // Take the last N non-empty lines (files often end with a trailing newline)
  const trimmed = allLines[allLines.length - 1] === "" ? allLines.slice(0, -1) : allLines;
  return trimmed.slice(-lines).join("\n");
}

/** Read recent stdout and stderr output from a job's log files */
export function readJobLogs(
  name: string,
  lines: number = 50
): { stdout: string; stderr: string } {
  return {
    stdout: tailFile(stdoutPath(name), lines),
    stderr: tailFile(stderrPath(name), lines),
  };
}

// --- Clearing ---

/** Truncate both stdout and stderr log files for a job */
export function clearJobLogs(name: string): void {
  ensureSchedulerDir();

  const out = stdoutPath(name);
  const err = stderrPath(name);
  if (existsSync(out)) writeFileSync(out, "", "utf-8");
  if (existsSync(err)) writeFileSync(err, "", "utf-8");
}

// --- Metadata ---

/** Get the last modification time of the stdout log as an ISO string, or null if no log exists */
export function getLastRunTimestamp(name: string): string | null {
  const out = stdoutPath(name);
  if (!existsSync(out)) return null;

  const stat = statSync(out);
  // Only return a timestamp if the file has content (has actually been written to)
  if (stat.size === 0) return null;

  return stat.mtime.toISOString();
}
