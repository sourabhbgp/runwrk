import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeKeyInput, readEnv, writeEnv } from "@/common/env";
import {
  createTestWorkspace,
  type TestWorkspace,
} from "../../helpers/fixtures";
import { writeFileSync } from "fs";
import { join } from "path";

// --- normalizeKeyInput (pure function) ---

describe("normalizeKeyInput", () => {
  it("returns trimmed value for plain strings", () => {
    expect(normalizeKeyInput("  sk-abc123  ")).toBe("sk-abc123");
  });

  it("strips export KEY=value prefix", () => {
    expect(normalizeKeyInput("export API_KEY=sk-abc123")).toBe("sk-abc123");
  });

  it("strips surrounding double quotes", () => {
    expect(normalizeKeyInput('"sk-abc123"')).toBe("sk-abc123");
  });

  it("strips surrounding single quotes", () => {
    expect(normalizeKeyInput("'sk-abc123'")).toBe("sk-abc123");
  });

  it('handles export KEY="value" (both prefix and quotes)', () => {
    expect(normalizeKeyInput('export API_KEY="sk-abc123"')).toBe("sk-abc123");
    expect(normalizeKeyInput("export API_KEY='sk-abc123'")).toBe("sk-abc123");
  });
});

// --- readEnv / writeEnv (filesystem) ---

describe("readEnv / writeEnv", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it("returns empty object when no .env.local exists", () => {
    // No .env.local file in the fresh temp workspace
    const env = readEnv();

    expect(env).toEqual({});
  });

  it("reads key=value pairs from .env.local", () => {
    writeFileSync(
      join(workspace.root, ".env.local"),
      "API_KEY=sk-abc\nSECRET=hunter2\n"
    );

    const env = readEnv();

    expect(env).toEqual({
      API_KEY: "sk-abc",
      SECRET: "hunter2",
    });
  });

  it("ignores blank lines and comments", () => {
    writeFileSync(
      join(workspace.root, ".env.local"),
      [
        "# This is a comment",
        "",
        "KEY_ONE=value1",
        "  ",
        "# Another comment",
        "KEY_TWO=value2",
        "",
      ].join("\n")
    );

    const env = readEnv();

    expect(env).toEqual({
      KEY_ONE: "value1",
      KEY_TWO: "value2",
    });
  });

  it("writeEnv writes and readEnv reads back correctly (round-trip)", () => {
    const original: Record<string, string> = {
      ANTHROPIC_API_KEY: "sk-ant-test",
      TWITTER_TOKEN: "rt-cookie-abc",
    };

    writeEnv(original);
    const result = readEnv();

    expect(result).toEqual(original);
  });
});
