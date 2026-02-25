/**
 * platform.test.ts — Tests for platform detection and path resolution.
 *
 * Tests cover:
 * - detectPlatform() returning the correct platform or throwing on unsupported
 * - detectPlatform() returning "daemon" when RUNWRK_DAEMON=1
 * - resolveExecutablePaths() producing valid absolute paths
 *
 * Uses Object.defineProperty to mock process.platform since vi.stubGlobal
 * is not available in Bun's vitest runtime.
 */

import { describe, it, expect, afterEach } from "vitest";
import { detectPlatform, resolveExecutablePaths } from "@/modules/scheduler/platform";
import { join } from "path";

// --- detectPlatform ---

describe("detectPlatform", () => {
  const originalPlatform = process.platform;
  const originalDaemonEnv = process.env.RUNWRK_DAEMON;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    if (originalDaemonEnv === undefined) {
      delete process.env.RUNWRK_DAEMON;
    } else {
      process.env.RUNWRK_DAEMON = originalDaemonEnv;
    }
  });

  it("returns 'darwin' on macOS", () => {
    delete process.env.RUNWRK_DAEMON;
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(detectPlatform()).toBe("darwin");
  });

  it("returns 'linux' on Linux", () => {
    delete process.env.RUNWRK_DAEMON;
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(detectPlatform()).toBe("linux");
  });

  it("throws on unsupported platforms", () => {
    delete process.env.RUNWRK_DAEMON;
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(() => detectPlatform()).toThrow(/Unsupported platform/);
  });

  it("returns 'daemon' when RUNWRK_DAEMON=1", () => {
    process.env.RUNWRK_DAEMON = "1";
    expect(detectPlatform()).toBe("daemon");
  });

  it("returns 'daemon' regardless of platform when RUNWRK_DAEMON=1", () => {
    process.env.RUNWRK_DAEMON = "1";
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(detectPlatform()).toBe("daemon");
  });

  it("does not return 'daemon' when RUNWRK_DAEMON is not '1'", () => {
    process.env.RUNWRK_DAEMON = "0";
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(detectPlatform()).toBe("darwin");
  });
});

// --- resolveExecutablePaths ---

describe("resolveExecutablePaths", () => {
  it("returns absolute paths for all fields", () => {
    const paths = resolveExecutablePaths();

    expect(paths.bunPath).toBeTruthy();
    expect(paths.entryPath).toContain("src/index.ts");
    expect(paths.projectRoot).toBe(process.cwd());
    expect(paths.bunDir).toBeTruthy();
    expect(paths.logDir).toContain(join(".runwrk", "scheduler", "logs"));
  });

  it("bunPath matches process.execPath", () => {
    const paths = resolveExecutablePaths();
    expect(paths.bunPath).toBe(process.execPath);
  });

  it("entryPath is under projectRoot", () => {
    const paths = resolveExecutablePaths();
    expect(paths.entryPath.startsWith(paths.projectRoot)).toBe(true);
  });
});
