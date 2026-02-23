import { describe, it, expect, vi } from "vitest";
import { withTimeout, TimeoutError } from "@/common/timeout";

describe("TimeoutError", () => {
  it("has the correct name and message including label and ms", () => {
    const err = new TimeoutError("fetchData", 5000);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TimeoutError");
    expect(err.message).toContain("fetchData");
    expect(err.message).toContain("5000");
    expect(err.message).toBe('Operation "fetchData" timed out after 5000ms');
  });
});

describe("withTimeout", () => {
  it("resolves when the promise completes within the timeout", async () => {
    const promise = Promise.resolve("done");

    const result = await withTimeout(promise, 1000, "fast-op");

    expect(result).toBe("done");
  });

  it("rejects with TimeoutError when the promise exceeds the timeout", async () => {
    // A promise that never resolves within the timeout window
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("too late"), 5000);
    });

    await expect(withTimeout(slow, 10, "slow-op")).rejects.toThrow(TimeoutError);
    await expect(
      withTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("late"), 5000)),
        10,
        "slow-op"
      )
    ).rejects.toThrow('Operation "slow-op" timed out after 10ms');
  });

  it("cleans up the timer after success (no dangling handles)", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await withTimeout(Promise.resolve("ok"), 5000, "cleanup-test");

    // clearTimeout should have been called in the finally block
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
