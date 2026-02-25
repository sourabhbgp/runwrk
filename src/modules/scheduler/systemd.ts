// Linux systemd backend — service/timer file generation and systemctl management

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ScheduledJob, ExecutablePaths } from "./types";

// --- Paths ---

/** Directory for user-level systemd unit files */
function systemdUserDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

/** Systemd unit name prefix for our jobs */
function unitName(name: string): string {
  return `runwrk-${name}`;
}

/** Full path to the .service file for a job */
export function servicePath(name: string): string {
  return join(systemdUserDir(), `${unitName(name)}.service`);
}

/** Full path to the .timer file for a job */
export function timerPath(name: string): string {
  return join(systemdUserDir(), `${unitName(name)}.timer`);
}

// --- Cron Conversion ---

/**
 * Convert a 5-field cron expression to systemd OnCalendar syntax.
 *
 * Cron:    minute hour day month weekday
 * Systemd: DayOfWeek Year-Month-Day Hour:Minute:Second
 *
 * Supports: specific numbers, comma-separated lists, and '*' (wildcard).
 * Does NOT support ranges or steps.
 *
 * Multiple values in the same field use comma separation in systemd too.
 * Returns an array of OnCalendar strings (one per combination when needed).
 */
export function cronToOnCalendar(cron: string): string[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  const [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

  // Map cron weekday numbers to systemd abbreviations (0 and 7 = Sunday)
  const weekdayMap: Record<number, string> = {
    0: "Sun",
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
    7: "Sun",
  };

  // Convert weekday field to systemd format
  const formatWeekday = (field: string): string => {
    if (field === "*") return "";
    const days = field.split(",").map((v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || !weekdayMap[n]) throw new Error(`Invalid weekday value: "${v}"`);
      return weekdayMap[n];
    });
    return days.join(",") + " ";
  };

  // Convert other fields: '*' stays '*', numbers stay as-is, commas preserved
  const formatField = (field: string): string => {
    if (field === "*") return "*";
    // Validate all values are numbers
    field.split(",").forEach((v) => {
      if (isNaN(parseInt(v, 10))) throw new Error(`Invalid cron value: "${v}"`);
    });
    return field;
  };

  const weekday = formatWeekday(weekdayStr);
  const month = formatField(monthStr);
  const day = formatField(dayStr);
  const hour = formatField(hourStr);
  const minute = formatField(minuteStr);

  // systemd format: "DayOfWeek Year-Month-Day Hour:Minute:00"
  // The year is always '*'
  const calendar = `${weekday}*-${month}-${day} ${hour}:${minute}:00`;

  return [calendar.trim()];
}

// --- Unit File Generation ---

/** Generate the systemd .service unit file content */
export function generateServiceFile(job: ScheduledJob, paths: ExecutablePaths): string {
  const description = job.description || `RunWrk job: ${job.name}`;
  const cmdArgs = job.command.split(/\s+/).join(" ");

  return `[Unit]
Description=RunWrk: ${description}

[Service]
Type=oneshot
ExecStart=${paths.bunPath} run ${paths.entryPath} ${cmdArgs}
WorkingDirectory=${paths.projectRoot}
StandardOutput=append:${join(paths.logDir, `${job.name}.stdout.log`)}
StandardError=append:${join(paths.logDir, `${job.name}.stderr.log`)}
`;
}

/** Generate the systemd .timer unit file content */
export function generateTimerFile(job: ScheduledJob): string {
  const description = job.description || `RunWrk job: ${job.name}`;
  const calendars = cronToOnCalendar(job.cron);

  const onCalendarLines = calendars
    .map((cal) => `OnCalendar=${cal}`)
    .join("\n");

  return `[Unit]
Description=Timer for RunWrk: ${description}

[Timer]
${onCalendarLines}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

// --- Install / Uninstall ---

/** Install a systemd timer: writes unit files, reloads daemon, enables + starts the timer */
export function installSystemd(job: ScheduledJob, paths: ExecutablePaths): void {
  const dir = systemdUserDir();
  mkdirSync(dir, { recursive: true });

  // Write service and timer files
  writeFileSync(servicePath(job.name), generateServiceFile(job, paths), "utf-8");
  writeFileSync(timerPath(job.name), generateTimerFile(job), "utf-8");

  // Reload systemd to pick up new files, then enable and start the timer
  const reload = Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
  if (reload.exitCode !== 0) {
    throw new Error(`systemctl daemon-reload failed: ${reload.stderr.toString().trim()}`);
  }

  const enable = Bun.spawnSync([
    "systemctl", "--user", "enable", "--now", `${unitName(job.name)}.timer`,
  ]);
  if (enable.exitCode !== 0) {
    throw new Error(`systemctl enable failed: ${enable.stderr.toString().trim()}`);
  }
}

/** Uninstall a systemd timer: stops, disables, removes files, and reloads */
export function uninstallSystemd(name: string): void {
  const timer = `${unitName(name)}.timer`;

  // Stop and disable the timer — ignore errors if not running
  Bun.spawnSync(["systemctl", "--user", "stop", timer]);
  Bun.spawnSync(["systemctl", "--user", "disable", timer]);

  // Remove unit files
  const svcPath = servicePath(name);
  const tmrPath = timerPath(name);
  if (existsSync(svcPath)) unlinkSync(svcPath);
  if (existsSync(tmrPath)) unlinkSync(tmrPath);

  // Reload so systemd forgets about the removed units
  Bun.spawnSync(["systemctl", "--user", "daemon-reload"]);
}

// --- Status ---

/** Check if the systemd timer file exists for the given job name */
export function isSystemdInstalled(name: string): boolean {
  return existsSync(timerPath(name));
}

/** Query systemd for timer status. Returns parsed info or null if not found. */
export function getSystemdStatus(name: string): {
  active: boolean;
  nextRun: string | null;
  lastExitCode: number | null;
} | null {
  const timer = `${unitName(name)}.timer`;
  const result = Bun.spawnSync(["systemctl", "--user", "show", timer, "--no-pager"]);

  if (result.exitCode !== 0) return null;

  const output = result.stdout.toString();
  const props = new Map<string, string>();

  // Parse key=value lines from systemctl show output
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      props.set(line.slice(0, eq), line.slice(eq + 1));
    }
  }

  const activeState = props.get("ActiveState");
  if (!activeState || activeState === "inactive") return null;

  // Get the next elapsation time
  const nextElapse = props.get("NextElapseUSecRealtime");
  let nextRun: string | null = null;
  if (nextElapse && nextElapse !== "0") {
    // systemd returns epoch microseconds — convert to ISO string
    const epochUs = parseInt(nextElapse, 10);
    if (!isNaN(epochUs)) {
      nextRun = new Date(epochUs / 1000).toISOString();
    }
  }

  // Get the exit code from the service (not the timer)
  const service = `${unitName(name)}.service`;
  const svcResult = Bun.spawnSync(["systemctl", "--user", "show", service, "--no-pager"]);
  let lastExitCode: number | null = null;

  if (svcResult.exitCode === 0) {
    const svcOutput = svcResult.stdout.toString();
    const codeMatch = svcOutput.match(/ExecMainStatus=(\d+)/);
    if (codeMatch) lastExitCode = parseInt(codeMatch[1], 10);
  }

  return {
    active: activeState === "active",
    nextRun,
    lastExitCode,
  };
}
