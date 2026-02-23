/**
 * Tests for stats.ts — the `myteam twitter stats` command output.
 *
 * Mocks memory, workflow, and workflow.migrate modules so no disk I/O occurs.
 * Uses fake timers for deterministic date-based stat bucketing.
 * Asserts on console.log output (already spied in tests/setup.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies — prevent disk reads and auto-migration side effects
vi.mock("@/modules/twitter/memory", () => ({
  readMemory: vi.fn(),
}));

vi.mock("@/modules/twitter/workflow", () => ({
  listWorkflows: vi.fn(() => []),
}));

vi.mock("@/modules/twitter/workflow.migrate", () => ({
  ensureMigrated: vi.fn(),
}));

import { twitterStats } from "@/modules/twitter/stats";
import { readMemory } from "@/modules/twitter/memory";
import { listWorkflows } from "@/modules/twitter/workflow";
import { createMockMemory } from "../../helpers/mock-data";
import { stripAnsi } from "../../helpers/strip";

// --- Helpers ---

/** Collect all console.log calls into a single ANSI-stripped string for easy assertions */
function getConsoleOutput(): string {
  const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((args: unknown[]) => args.map(String).join(" ")).map(stripAnsi).join("\n");
}

// --- Setup ---

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Single Workflow Mode (--workflow) ---

describe("twitterStats with --workflow", () => {
  it("calls readMemory with the workflow name", async () => {
    vi.mocked(readMemory).mockReturnValue(createMockMemory());

    await twitterStats({ workflow: "my-campaign" });

    expect(readMemory).toHaveBeenCalledWith("my-campaign");
  });

  it("shows 'No engagement data yet' when memory is empty", async () => {
    vi.mocked(readMemory).mockReturnValue(createMockMemory());

    await twitterStats({ workflow: "empty-wf" });

    const output = getConsoleOutput();
    expect(output).toContain("No engagement data yet");
  });

  it("displays today's stats when dailyStats has data for today", async () => {
    const mem = createMockMemory({
      dailyStats: {
        "2026-02-20": {
          replies: 5,
          likes: 10,
          posts: 2,
          retweets: 1,
          follows: 3,
        },
      },
    });
    vi.mocked(readMemory).mockReturnValue(mem);

    await twitterStats({ workflow: "active-wf" });

    const output = getConsoleOutput();

    // Verify today's date header is shown
    expect(output).toContain("2026-02-20");

    // Verify each stat value appears in the output
    expect(output).toContain("5");   // replies
    expect(output).toContain("10");  // likes
    expect(output).toContain("2");   // posts
    expect(output).toContain("1");   // retweets
    expect(output).toContain("3");   // follows
  });

  it("displays the workflow name in the header", async () => {
    vi.mocked(readMemory).mockReturnValue(createMockMemory());

    await twitterStats({ workflow: "brand-growth" });

    const output = getConsoleOutput();
    expect(output).toContain("brand-growth");
  });
});

// --- All Workflows Summary (no --workflow) ---

describe("twitterStats without --workflow", () => {
  it("calls listWorkflows to enumerate all workflows", async () => {
    vi.mocked(listWorkflows).mockReturnValue([]);

    await twitterStats({});

    expect(listWorkflows).toHaveBeenCalled();
  });

  it("shows 'No workflows found' when there are no workflows", async () => {
    vi.mocked(listWorkflows).mockReturnValue([]);

    await twitterStats({});

    const output = getConsoleOutput();
    expect(output).toContain("No workflows found");
  });

  it("shows summary for each workflow when workflows exist", async () => {
    vi.mocked(listWorkflows).mockReturnValue(["alpha", "beta"]);

    // Return different stats per workflow based on the name argument
    vi.mocked(readMemory).mockImplementation((name?: string) => {
      if (name === "alpha") {
        return createMockMemory({
          dailyStats: {
            "2026-02-19": { replies: 3, likes: 8, posts: 1, retweets: 0, follows: 2 },
            "2026-02-20": { replies: 4, likes: 6, posts: 2, retweets: 1, follows: 1 },
          },
        });
      }
      if (name === "beta") {
        return createMockMemory({
          dailyStats: {
            "2026-02-20": { replies: 1, likes: 3, posts: 0, retweets: 2, follows: 0 },
          },
        });
      }
      return createMockMemory();
    });

    await twitterStats({});

    const output = getConsoleOutput();

    // Both workflow names should appear
    expect(output).toContain("alpha");
    expect(output).toContain("beta");

    // Alpha all-time totals: 7 replies, 14 likes, 3 posts, 1 RT, 3 follows
    expect(output).toContain("7");   // alpha replies total
    expect(output).toContain("14");  // alpha likes total

    // Beta all-time totals: 1 reply, 3 likes
    // (these are smaller numbers that may appear in other contexts,
    //  so we check that readMemory was called for both workflows)
    expect(readMemory).toHaveBeenCalledWith("alpha");
    expect(readMemory).toHaveBeenCalledWith("beta");
  });

  it("shows grand totals when multiple workflows exist", async () => {
    vi.mocked(listWorkflows).mockReturnValue(["wf-a", "wf-b"]);

    vi.mocked(readMemory).mockImplementation((name?: string) => {
      if (name === "wf-a") {
        return createMockMemory({
          dailyStats: {
            "2026-02-20": { replies: 10, likes: 20, posts: 5, retweets: 3, follows: 2 },
          },
        });
      }
      if (name === "wf-b") {
        return createMockMemory({
          dailyStats: {
            "2026-02-20": { replies: 5, likes: 10, posts: 3, retweets: 1, follows: 4 },
          },
        });
      }
      return createMockMemory();
    });

    await twitterStats({});

    const output = getConsoleOutput();

    // Grand totals: 15 replies, 30 likes, 8 posts, 4 RTs, 6 follows
    expect(output).toContain("Total across all workflows");
    expect(output).toContain("15");  // total replies
    expect(output).toContain("30");  // total likes
  });

  it("does not show grand totals for a single workflow", async () => {
    vi.mocked(listWorkflows).mockReturnValue(["only-one"]);

    vi.mocked(readMemory).mockReturnValue(
      createMockMemory({
        dailyStats: {
          "2026-02-20": { replies: 2, likes: 4, posts: 1, retweets: 0, follows: 1 },
        },
      }),
    );

    await twitterStats({});

    const output = getConsoleOutput();

    expect(output).toContain("only-one");
    expect(output).not.toContain("Total across all workflows");
  });
});
