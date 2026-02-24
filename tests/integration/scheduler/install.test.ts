/**
 * install.test.ts — Integration tests for the scheduler install/uninstall flow.
 *
 * Tests the full flow from addJob → installJob → uninstallJob → removeJob
 * with mocked Bun.spawnSync to avoid real OS timer manipulation.
 * Uses createTestWorkspace() for filesystem isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../../helpers";
import {
  addJob,
  listJobs,
  getJob,
  removeJob,
  updateJob,
  ensureSchedulerDir,
} from "@/modules/scheduler/jobs";
import { installJob, uninstallJob } from "@/modules/scheduler/platform";
import { existsSync } from "fs";
import { plistPath } from "@/modules/scheduler/launchd";

let workspace: TestWorkspace;
const originalPlatform = process.platform;

beforeEach(() => {
  workspace = createTestWorkspace();
  ensureSchedulerDir();
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  workspace.cleanup();
});

// --- Full Lifecycle (macOS) ---

describe("scheduler lifecycle on macOS", () => {
  beforeEach(() => {
    // Mock platform as darwin
    Object.defineProperty(process, "platform", { value: "darwin" });

    // Mock Bun.spawnSync to capture commands without running them
    vi.spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [cmd];
      const command = args[0];

      // Return uid for launchctl commands
      if (command === "id") {
        return { exitCode: 0, stdout: Buffer.from("501"), stderr: Buffer.from("") } as any;
      }

      // launchctl bootstrap — simulate success
      if (command === "launchctl" && args[1] === "bootstrap") {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }

      // launchctl bootout — simulate success
      if (command === "launchctl" && args[1] === "bootout") {
        return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
      }

      // launchctl list — simulate not found
      if (command === "launchctl" && args[1] === "list") {
        return { exitCode: 113, stdout: Buffer.from(""), stderr: Buffer.from("Could not find service") } as any;
      }

      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });
  });

  it("adds a job, installs it, then removes it", () => {
    // Add
    const job = addJob({
      name: "lifecycle-test",
      command: "twitter -w growth",
      cron: "0 9 * * *",
      description: "Test job",
    });

    expect(job.name).toBe("lifecycle-test");
    expect(job.enabled).toBe(true);
    expect(listJobs()).toHaveLength(1);

    // Install — writes plist and calls launchctl
    installJob(job);
    expect(existsSync(plistPath("lifecycle-test"))).toBe(true);

    // Verify launchctl bootstrap was called
    const spy = Bun.spawnSync as ReturnType<typeof vi.fn>;
    const bootstrapCall = spy.mock.calls.find(
      (call: any[]) => Array.isArray(call[0]) && call[0][0] === "launchctl" && call[0][1] === "bootstrap"
    );
    expect(bootstrapCall).toBeTruthy();

    // Uninstall — calls launchctl bootout and removes plist
    uninstallJob("lifecycle-test");

    // Remove from registry
    const removed = removeJob("lifecycle-test");
    expect(removed).toBe(true);
    expect(listJobs()).toHaveLength(0);
  });

  it("disable pauses a job (uninstalls timer, keeps registry entry)", () => {
    const job = addJob({
      name: "pause-test",
      command: "twitter -w niche",
      cron: "0 14 * * *",
    });

    installJob(job);

    // Disable: uninstall timer, update registry
    uninstallJob("pause-test");
    const updated = updateJob("pause-test", { enabled: false });

    expect(updated.enabled).toBe(false);
    expect(getJob("pause-test")).not.toBeNull(); // still in registry
  });

  it("enable re-enables a paused job (reinstalls timer)", () => {
    const job = addJob({
      name: "reenable-test",
      command: "chat",
      cron: "0 8 * * 1",
    });

    // Disable first
    updateJob("reenable-test", { enabled: false });

    // Re-enable: update registry, reinstall
    const updated = updateJob("reenable-test", { enabled: true });
    installJob(updated);

    expect(updated.enabled).toBe(true);
    expect(existsSync(plistPath("reenable-test"))).toBe(true);
  });
});

// --- Error Cases ---

describe("scheduler error handling", () => {
  it("installJob throws on unsupported platform", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const job = addJob({
      name: "error-test",
      command: "twitter -w test",
      cron: "0 9 * * *",
    });

    expect(() => installJob(job)).toThrow(/Unsupported platform/);
  });

  it("installJob throws when launchctl fails", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    vi.spyOn(Bun, "spawnSync").mockImplementation((cmd: any) => {
      const args = Array.isArray(cmd) ? cmd : [cmd];
      if (args[0] === "id") {
        return { exitCode: 0, stdout: Buffer.from("501"), stderr: Buffer.from("") } as any;
      }
      if (args[0] === "launchctl" && args[1] === "bootstrap") {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("Permission denied") } as any;
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") } as any;
    });

    const job = addJob({
      name: "fail-test",
      command: "twitter -w test",
      cron: "0 9 * * *",
    });

    expect(() => installJob(job)).toThrow(/launchctl bootstrap failed/);
  });
});
