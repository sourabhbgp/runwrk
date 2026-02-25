/**
 * logger.test.ts — Tests for the structured logging module.
 *
 * Verifies createAppLogger, getLogger singleton, level filtering, child loggers,
 * file JSONL output, log rotation, daemon mode, and RUNWRK_DEBUG env var.
 * Uses a temp directory for log files to avoid polluting the project.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createAppLogger, getLogger, resetLogger } from "@/common/logger";

// --- Setup ---

let tempDir: string;

beforeEach(() => {
  resetLogger();
  tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
});

afterEach(() => {
  resetLogger();
});

// --- createAppLogger ---

describe("createAppLogger", () => {
  it("returns a pino logger instance with expected methods", async () => {
    const logFile = join(tempDir, "test.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true });

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("writes JSONL entries to the log file", async () => {
    const logFile = join(tempDir, "output.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true, level: "info" });

    logger.info({ foo: "bar" }, "test message");

    const content = readFileSync(logFile, "utf-8").trim();
    const lines = content.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.msg).toBe("test message");
    expect(entry.foo).toBe("bar");
    expect(entry.level).toBe(30); // pino info level
  });

  it("respects level filtering — debug messages suppressed at info level", async () => {
    const logFile = join(tempDir, "level-filter.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true, level: "info" });

    logger.debug("should not appear");
    logger.info("should appear");

    const content = readFileSync(logFile, "utf-8").trim();
    expect(content).not.toContain("should not appear");
    expect(content).toContain("should appear");
  });

  it("allows debug messages when level is debug", async () => {
    const logFile = join(tempDir, "debug-level.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true, level: "debug" });

    logger.debug("debug visible");

    const content = readFileSync(logFile, "utf-8").trim();
    expect(content).toContain("debug visible");
  });
});

// --- child loggers ---

describe("child loggers", () => {
  it("merges bindings into child logger output", async () => {
    const logFile = join(tempDir, "child.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true });

    const child = logger.child({ component: "daemon" });
    child.info("child message");

    const content = readFileSync(logFile, "utf-8").trim();
    const lines = content.split("\n").filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.component).toBe("daemon");
    expect(entry.msg).toBe("child message");
  });

  it("nested children merge all bindings", async () => {
    const logFile = join(tempDir, "nested-child.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true });

    const child = logger.child({ component: "twitter" }).child({ workflow: "growth" });
    child.info("nested");

    const content = readFileSync(logFile, "utf-8").trim();
    const lines = content.split("\n").filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);
    expect(entry.component).toBe("twitter");
    expect(entry.workflow).toBe("growth");
  });
});

// --- getLogger singleton ---

describe("getLogger", () => {
  it("returns a fallback logger before async init", () => {
    resetLogger();
    const logger = getLogger();

    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("returns the initialized logger after createAppLogger", async () => {
    const logFile = join(tempDir, "singleton.log");
    const created = await createAppLogger({ logFile, jsonConsole: true });
    const got = getLogger();

    // Should be the same instance
    expect(got).toBe(created);
  });

  it("returns the same instance on repeated calls", () => {
    const a = getLogger();
    const b = getLogger();
    expect(a).toBe(b);
  });
});

// --- RUNWRK_DEBUG env var ---

describe("RUNWRK_DEBUG", () => {
  it("sets level to debug when RUNWRK_DEBUG=1", async () => {
    const original = process.env.RUNWRK_DEBUG;
    process.env.RUNWRK_DEBUG = "1";

    try {
      const logFile = join(tempDir, "debug-env.log");
      const logger = await createAppLogger({ logFile, jsonConsole: true });

      logger.debug("env debug message");

      const content = readFileSync(logFile, "utf-8").trim();
      expect(content).toContain("env debug message");
    } finally {
      if (original === undefined) {
        delete process.env.RUNWRK_DEBUG;
      } else {
        process.env.RUNWRK_DEBUG = original;
      }
    }
  });
});

// --- Daemon mode ---

describe("daemon mode", () => {
  it("outputs JSON to file in daemon mode", async () => {
    const logFile = join(tempDir, "daemon.log");
    // jsonConsole: true simulates daemon mode
    const logger = await createAppLogger({ logFile, jsonConsole: true });

    logger.info({ component: "daemon" }, "daemon started");

    const content = readFileSync(logFile, "utf-8").trim();
    const entry = JSON.parse(content.split("\n").pop()!);
    expect(entry.component).toBe("daemon");
    expect(entry.msg).toBe("daemon started");
  });
});

// --- Log file directory creation ---

describe("log file directory", () => {
  it("creates nested directories for log file path", async () => {
    const logFile = join(tempDir, "nested", "deep", "test.log");
    const logger = await createAppLogger({ logFile, jsonConsole: true });

    logger.info("nested dir test");

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8").trim();
    expect(content).toContain("nested dir test");
  });
});

// --- Log rotation ---

describe("log rotation", () => {
  it("rotates when file exceeds maxFileSize on startup", async () => {
    const logFile = join(tempDir, "rotate.log");

    // Create a file larger than 100 bytes (our test threshold)
    writeFileSync(logFile, "x".repeat(200));

    // Create logger with small maxFileSize — triggers rotation on init
    await createAppLogger({ logFile, jsonConsole: true, maxFileSize: 100, maxFiles: 3 });

    // Original should have been rotated to .1
    const rotated = join(tempDir, "rotate.1.log");
    expect(existsSync(rotated)).toBe(true);
    expect(readFileSync(rotated, "utf-8")).toBe("x".repeat(200));

    // New active log should exist and be small (empty or just new writes)
    expect(existsSync(logFile)).toBe(true);
  });

  it("shifts existing backups during rotation", async () => {
    const logFile = join(tempDir, "shift.log");
    const backup1 = join(tempDir, "shift.1.log");

    // Create existing backup and oversized active file
    writeFileSync(backup1, "backup-1-content");
    writeFileSync(logFile, "x".repeat(200));

    await createAppLogger({ logFile, jsonConsole: true, maxFileSize: 100, maxFiles: 3 });

    // Old .1 should have shifted to .2
    const backup2 = join(tempDir, "shift.2.log");
    expect(existsSync(backup2)).toBe(true);
    expect(readFileSync(backup2, "utf-8")).toBe("backup-1-content");

    // New .1 should be the old active file
    expect(existsSync(backup1)).toBe(true);
    expect(readFileSync(backup1, "utf-8")).toBe("x".repeat(200));
  });

  it("deletes oldest backup when at maxFiles limit", async () => {
    const logFile = join(tempDir, "limit.log");

    // Create backups up to the limit
    writeFileSync(join(tempDir, "limit.1.log"), "backup-1");
    writeFileSync(join(tempDir, "limit.2.log"), "backup-2");
    writeFileSync(join(tempDir, "limit.3.log"), "backup-3-should-be-deleted");
    writeFileSync(logFile, "x".repeat(200));

    await createAppLogger({ logFile, jsonConsole: true, maxFileSize: 100, maxFiles: 3 });

    // .3 (oldest) should still exist but now contains what was .2
    expect(readFileSync(join(tempDir, "limit.3.log"), "utf-8")).toBe("backup-2");
    // The original .3 content was deleted
  });

  it("does not rotate when file is under maxFileSize", async () => {
    const logFile = join(tempDir, "small.log");
    writeFileSync(logFile, "small");

    await createAppLogger({ logFile, jsonConsole: true, maxFileSize: 1000, maxFiles: 3 });

    // No rotation — .1 backup should not exist
    expect(existsSync(join(tempDir, "small.1.log"))).toBe(false);
  });
});
