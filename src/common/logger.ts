// Structured logging via pino — dual output (console + rotating file).
// Uses pino.multistream() with pino.destination() for Bun compatibility.
// File rotation is size-based, checked at logger initialization.

import pino from "pino";
import { mkdirSync, existsSync, statSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";

// --- Types ---

export interface LoggerConfig {
  /** Minimum log level (default: "info", or "debug" if MYTEAM_DEBUG=1) */
  level?: string;
  /** Path to the JSONL log file (default: ".myteam/logs/myteam.log") */
  logFile?: string;
  /** Max file size in bytes before rotation (default: 5MB) */
  maxFileSize?: number;
  /** Number of rotated backups to keep (default: 3) */
  maxFiles?: number;
  /** Force JSON console output (default: auto-detect from MYTEAM_DAEMON env) */
  jsonConsole?: boolean;
}

export type { Logger } from "pino";

// --- Constants ---

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_FILES = 3;

// --- Singleton ---

let _logger: pino.Logger | null = null;

/** Lazy fallback logger — synchronous, console-only, used before async init completes */
function fallbackLogger(): pino.Logger {
  return pino({ level: resolveLevel() });
}

/** Resolve log level from config or environment */
function resolveLevel(configLevel?: string): pino.Level {
  if (configLevel) return configLevel as pino.Level;
  if (process.env.MYTEAM_DEBUG === "1") return "debug";
  return "info";
}

/** Ensure log file directory exists */
function ensureLogDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- File Rotation ---

/** Rotate log files if the current one exceeds maxFileSize.
 *  Shifts existing backups (myteam.1.log → myteam.2.log) and renames
 *  the active file to myteam.1.log. Deletes the oldest if over maxFiles. */
function rotateIfNeeded(logFile: string, maxFileSize: number, maxFiles: number): void {
  if (!existsSync(logFile)) return;

  const stats = statSync(logFile);
  if (stats.size < maxFileSize) return;

  // Build backup file names: myteam.1.log, myteam.2.log, etc.
  const ext = logFile.endsWith(".log") ? ".log" : "";
  const base = ext ? logFile.slice(0, -ext.length) : logFile;

  // Delete oldest backup if it exists
  const oldest = `${base}.${maxFiles}${ext}`;
  if (existsSync(oldest)) unlinkSync(oldest);

  // Shift existing backups up by one
  for (let i = maxFiles - 1; i >= 1; i--) {
    const from = `${base}.${i}${ext}`;
    const to = `${base}.${i + 1}${ext}`;
    if (existsSync(from)) renameSync(from, to);
  }

  // Move active log to .1
  renameSync(logFile, `${base}.1${ext}`);
}

// --- Factory ---

/** Create a configured pino logger with dual output (console + rotating file).
 *  In daemon mode: JSON to stdout + JSON to file.
 *  In interactive mode: pretty-print to stdout + JSON to file. */
export async function createAppLogger(config: LoggerConfig = {}): Promise<pino.Logger> {
  const level = resolveLevel(config.level);
  const logFile = config.logFile ?? ".myteam/logs/myteam.log";
  const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = config.maxFiles ?? DEFAULT_MAX_FILES;
  const isDaemon = config.jsonConsole ?? process.env.MYTEAM_DAEMON === "1";

  ensureLogDir(logFile);

  // Rotate on startup if the log file is too large
  rotateIfNeeded(logFile, maxFileSize, maxFiles);

  // Build the streams array for pino.multistream()
  const streams: pino.StreamEntry[] = [];

  // Console stream — JSON in daemon mode, pretty in interactive mode
  if (isDaemon) {
    streams.push({ level, stream: process.stdout });
  } else {
    try {
      // pino-pretty is a dev dependency — may not be available in production
      const { default: pinoPretty } = await import("pino-pretty");
      streams.push({
        level,
        stream: pinoPretty({ colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" }),
      });
    } catch {
      // Fallback to plain JSON if pino-pretty isn't installed
      streams.push({ level, stream: process.stdout });
    }
  }

  // File stream — synchronous pino.destination for reliable writes in Bun
  const fileStream = pino.destination({ dest: logFile, mkdir: true, sync: true });
  streams.push({ level, stream: fileStream });

  const logger = pino(
    { level },
    pino.multistream(streams),
  );

  // Cache as singleton
  _logger = logger;
  return logger;
}

/** Get the logger singleton. Returns a fallback console logger if init hasn't completed. */
export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = fallbackLogger();
  }
  return _logger;
}

/** Reset the singleton (for testing) */
export function resetLogger(): void {
  _logger = null;
}
