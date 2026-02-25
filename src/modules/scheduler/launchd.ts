// macOS launchd backend — plist generation and launchctl management

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ScheduledJob, ExecutablePaths } from "./types";

// --- Paths ---

/** Directory where user-level launch agents live */
function launchAgentsDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

/** Label used for the launchd job (matches plist filename) */
export function jobLabel(name: string): string {
  return `com.runwrk.${name}`;
}

/** Full path to the plist file for a given job */
export function plistPath(name: string): string {
  return join(launchAgentsDir(), `${jobLabel(name)}.plist`);
}

// --- Cron Conversion ---

/**
 * Convert a 5-field cron expression to launchd StartCalendarInterval dicts.
 *
 * Supports: specific numbers, comma-separated lists, and '*' (wildcard).
 * Does NOT support ranges (1-5), steps (* /15), or other advanced cron syntax.
 *
 * Fields: minute hour dayOfMonth month dayOfWeek (0=Sunday)
 *
 * Returns an array of calendar interval objects. Multiple values in a field
 * produce the cartesian product (e.g. hours "9,14" → two entries).
 */
export function cronToCalendarIntervals(
  cron: string
): Array<Record<string, number>> {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

  // Parse a single cron field into an array of numbers or null (wildcard)
  const parseField = (field: string): number[] | null => {
    if (field === "*") return null;
    return field.split(",").map((v) => {
      const n = parseInt(v, 10);
      if (isNaN(n)) throw new Error(`Invalid cron value: "${v}"`);
      return n;
    });
  };

  const minutes = parseField(minuteStr);
  const hours = parseField(hourStr);
  const days = parseField(dayStr);
  const months = parseField(monthStr);
  const weekdays = parseField(weekdayStr);

  // Build the cartesian product of all non-wildcard fields
  // Each combination becomes one StartCalendarInterval dict
  const fieldDefs: Array<{ key: string; values: number[] | null }> = [
    { key: "Minute", values: minutes },
    { key: "Hour", values: hours },
    { key: "Day", values: days },
    { key: "Month", values: months },
    { key: "Weekday", values: weekdays },
  ];

  // Start with one empty dict, then expand for each field with explicit values
  let results: Array<Record<string, number>> = [{}];

  for (const { key, values } of fieldDefs) {
    if (values === null) continue; // wildcard — omit from dict (launchd treats as "any")

    const expanded: Array<Record<string, number>> = [];
    for (const existing of results) {
      for (const val of values) {
        expanded.push({ ...existing, [key]: val });
      }
    }
    results = expanded;
  }

  return results;
}

// --- Plist Generation ---

/** Escape XML special characters in a string value */
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Generate a single StartCalendarInterval dict block */
function calendarIntervalXml(interval: Record<string, number>): string {
  const entries = Object.entries(interval)
    .map(
      ([key, val]) =>
        `            <key>${key}</key>\n            <integer>${val}</integer>`
    )
    .join("\n");
  return `        <dict>\n${entries}\n        </dict>`;
}

/** Generate the full plist XML for a scheduled job */
export function generatePlist(job: ScheduledJob, paths: ExecutablePaths): string {
  const label = jobLabel(job.name);
  const intervals = cronToCalendarIntervals(job.cron);

  // Split the command string into arguments for ProgramArguments
  const cmdArgs = job.command.split(/\s+/);
  const programArgs = [paths.bunPath, "run", paths.entryPath, ...cmdArgs]
    .map((arg) => `        <string>${xmlEscape(arg)}</string>`)
    .join("\n");

  // Build the StartCalendarInterval section
  const calendarSection =
    intervals.length === 1
      ? `    <key>StartCalendarInterval</key>\n${calendarIntervalXml(intervals[0])}`
      : `    <key>StartCalendarInterval</key>\n    <array>\n${intervals.map(calendarIntervalXml).join("\n")}\n    </array>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(label)}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
${calendarSection}
    <key>StandardOutPath</key>
    <string>${xmlEscape(join(paths.logDir, `${job.name}.stdout.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(join(paths.logDir, `${job.name}.stderr.log`))}</string>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(paths.projectRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${xmlEscape(paths.bunDir)}</string>
    </dict>
</dict>
</plist>
`;
}

// --- Install / Uninstall ---

/** Install a launchd job: writes the plist and loads it via launchctl */
export function installLaunchd(job: ScheduledJob, paths: ExecutablePaths): void {
  const path = plistPath(job.name);
  const xml = generatePlist(job, paths);

  writeFileSync(path, xml, "utf-8");

  // Load the agent via launchctl bootstrap (modern API, replaces `launchctl load`)
  const uid = Bun.spawnSync(["id", "-u"]).stdout.toString().trim();
  const result = Bun.spawnSync(["launchctl", "bootstrap", `gui/${uid}`, path]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    // Exit code 37 means the service is already loaded — treat as success
    if (result.exitCode !== 37) {
      throw new Error(`launchctl bootstrap failed (exit ${result.exitCode}): ${stderr}`);
    }
  }
}

/** Uninstall a launchd job: removes from launchctl and deletes the plist */
export function uninstallLaunchd(name: string): void {
  const path = plistPath(name);
  const label = jobLabel(name);

  // Bootout (unload) the agent — ignore errors if not loaded
  const uid = Bun.spawnSync(["id", "-u"]).stdout.toString().trim();
  Bun.spawnSync(["launchctl", "bootout", `gui/${uid}/${label}`]);

  // Remove the plist file
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

// --- Status ---

/** Check if a launchd plist exists for the given job name */
export function isLaunchdInstalled(name: string): boolean {
  return existsSync(plistPath(name));
}

/** Query launchd for the status of a job. Returns parsed info or null if not found. */
export function getLaunchdStatus(name: string): {
  pid: number | null;
  lastExitCode: number | null;
} | null {
  const label = jobLabel(name);
  const result = Bun.spawnSync(["launchctl", "list", label]);

  if (result.exitCode !== 0) return null;

  const output = result.stdout.toString();
  let pid: number | null = null;
  let lastExitCode: number | null = null;

  // Parse the key-value output from `launchctl list <label>`
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith('"PID"')) {
      const match = trimmed.match(/=\s*(\d+)/);
      if (match) pid = parseInt(match[1], 10);
    } else if (trimmed.startsWith('"LastExitStatus"')) {
      const match = trimmed.match(/=\s*(\d+)/);
      if (match) lastExitCode = parseInt(match[1], 10);
    }
  }

  return { pid, lastExitCode };
}
