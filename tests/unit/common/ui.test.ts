import { describe, it, expect, vi } from "vitest";
import {
  bold,
  dim,
  green,
  red,
  cyan,
  yellow,
  banner,
  divider,
  success,
  error,
  warn,
  info,
} from "@/common/ui";
import { stripAnsi } from "../../helpers/strip";

// --- ANSI Formatting Functions ---

describe("ANSI formatting functions", () => {
  it("bold wraps text with correct ANSI codes", () => {
    const result = bold("hello");

    // Raw output contains escape codes
    expect(result).toContain("\x1b[");
    expect(result).not.toBe("hello");
    // Stripped output matches original text
    expect(stripAnsi(result)).toBe("hello");
  });

  it("dim wraps text with correct ANSI codes", () => {
    const result = dim("hello");

    expect(result).toContain("\x1b[");
    expect(result).not.toBe("hello");
    expect(stripAnsi(result)).toBe("hello");
  });

  it("green wraps text with correct ANSI codes", () => {
    const result = green("hello");

    expect(result).toContain("\x1b[");
    expect(result).not.toBe("hello");
    expect(stripAnsi(result)).toBe("hello");
  });

  it("red wraps text with correct ANSI codes", () => {
    const result = red("hello");

    expect(result).toContain("\x1b[");
    expect(result).not.toBe("hello");
    expect(stripAnsi(result)).toBe("hello");
  });

  it("cyan wraps text with correct ANSI codes", () => {
    const result = cyan("hello");

    expect(result).toContain("\x1b[");
    expect(result).not.toBe("hello");
    expect(stripAnsi(result)).toBe("hello");
  });

  it("yellow wraps text with correct ANSI codes", () => {
    const result = yellow("hello");

    expect(result).toContain("\x1b[");
    expect(result).not.toBe("hello");
    expect(stripAnsi(result)).toBe("hello");
  });
});

// --- Console Output Functions ---

describe("banner", () => {
  it("calls console.log with 'myteam'", () => {
    const logSpy = vi.spyOn(console, "log");

    banner();

    expect(logSpy).toHaveBeenCalled();
    // The banner output should contain "myteam" when stripped of ANSI codes
    const output = logSpy.mock.calls[0][0] as string;
    expect(stripAnsi(output)).toContain("myteam");
  });
});

describe("divider", () => {
  it("calls console.log with repeating dashes", () => {
    const logSpy = vi.spyOn(console, "log");

    divider();

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    const stripped = stripAnsi(output);
    // Should contain the Unicode horizontal line character repeated
    expect(stripped).toMatch(/─{10,}/);
  });
});

describe("success", () => {
  it("calls console.log with checkmark + msg", () => {
    const logSpy = vi.spyOn(console, "log");

    success("all good");

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    const stripped = stripAnsi(output);
    expect(stripped).toContain("✓");
    expect(stripped).toContain("all good");
  });
});

describe("error", () => {
  it("calls console.error with cross + msg", () => {
    const errorSpy = vi.spyOn(console, "error");

    error("something failed");

    expect(errorSpy).toHaveBeenCalled();
    const output = errorSpy.mock.calls[0][0] as string;
    const stripped = stripAnsi(output);
    expect(stripped).toContain("✗");
    expect(stripped).toContain("something failed");
  });
});

describe("warn", () => {
  it("calls console.error with warning sign + msg", () => {
    const errorSpy = vi.spyOn(console, "error");

    warn("watch out");

    expect(errorSpy).toHaveBeenCalled();
    // Use the last call — Bun's vitest may not fully clear spy history between tests
    const calls = errorSpy.mock.calls;
    const output = calls[calls.length - 1][0] as string;
    const stripped = stripAnsi(output);
    expect(stripped).toContain("⚠");
    expect(stripped).toContain("watch out");
  });
});

describe("info", () => {
  it("calls console.log with arrow + msg", () => {
    const logSpy = vi.spyOn(console, "log");

    info("heads up");

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    const stripped = stripAnsi(output);
    expect(stripped).toContain("→");
    expect(stripped).toContain("heads up");
  });
});
