/**
 * Tests for memory.actions.ts — the raw engagement action log layer.
 *
 * Covers persistence (readActionStore / saveActionStore round-trips),
 * action logging, duplicate checks, consolidation helpers, daily stats
 * aggregation, today's count queries, skip pattern analysis, and
 * recent reply formatting.
 *
 * Uses fake timers pinned to 2026-02-20T12:00:00Z for deterministic
 * date-dependent behavior (getTodayCount, getUnconsolidated, markConsolidated).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  readActionStore,
  saveActionStore,
  logAction,
  hasEngaged,
  getUnconsolidated,
  markConsolidated,
  getDailyStats,
  getTodayCount,
  getSkipPatterns,
  getRecentReplies,
} from "@/modules/twitter/memory.actions";
import { workflowActionsPath } from "@/modules/twitter/workflow";
import type { Action, ActionStore } from "@/modules/twitter/memory.types";

const WF = "test-wf";
let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
  workspace = createTestWorkspace();
  // Create the workflow directory so actions.json can be written there
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- Helper Factories ---

/** Create an action with sensible defaults, overridable per-field */
function makeAction(overrides?: Partial<Action>): Action {
  return {
    type: "reply",
    tweetId: "tweet-1",
    userId: "user-1",
    username: "alice",
    text: "Great take!",
    date: "2026-02-20T12:00:00.000Z",
    consolidated: false,
    ...overrides,
  };
}

/** Create an ActionStore with sensible defaults, overridable per-field */
function makeStore(overrides?: Partial<ActionStore>): ActionStore {
  return {
    actions: [],
    directives: [],
    lastConsolidation: null,
    ...overrides,
  };
}

// --- readActionStore / saveActionStore ---

describe("readActionStore / saveActionStore", () => {
  it("readActionStore returns empty defaults when no file exists", () => {
    const store = readActionStore(WF);

    expect(store.actions).toEqual([]);
    expect(store.directives).toEqual([]);
    expect(store.lastConsolidation).toBeNull();
  });

  it("saveActionStore + readActionStore round-trips data", () => {
    const store = makeStore({
      actions: [makeAction({ tweetId: "t1" }), makeAction({ tweetId: "t2", type: "like" })],
      directives: ["Be concise", "Avoid crypto topics"],
      lastConsolidation: "2026-02-19T06:00:00.000Z",
    });

    saveActionStore(store, WF);
    const loaded = readActionStore(WF);

    expect(loaded.actions).toHaveLength(2);
    expect(loaded.actions[0].tweetId).toBe("t1");
    expect(loaded.actions[1].type).toBe("like");
    expect(loaded.directives).toEqual(["Be concise", "Avoid crypto topics"]);
    expect(loaded.lastConsolidation).toBe("2026-02-19T06:00:00.000Z");
  });

  it("readActionStore returns empty defaults for corrupted JSON", () => {
    // Write invalid JSON to the actions file
    writeFileSync(workflowActionsPath(WF), "not valid json{{{");

    const store = readActionStore(WF);

    expect(store.actions).toEqual([]);
    expect(store.directives).toEqual([]);
    expect(store.lastConsolidation).toBeNull();
  });
});

// --- logAction ---

describe("logAction", () => {
  it("appends an action and persists it to disk", () => {
    const action = makeAction({ tweetId: "t10", type: "reply", username: "bob" });

    logAction(action, WF);

    const store = readActionStore(WF);
    expect(store.actions).toHaveLength(1);
    expect(store.actions[0].tweetId).toBe("t10");
    expect(store.actions[0].username).toBe("bob");
    expect(store.actions[0].type).toBe("reply");
  });

  it("appends multiple actions in order", () => {
    logAction(makeAction({ tweetId: "t1", type: "reply" }), WF);
    logAction(makeAction({ tweetId: "t2", type: "like" }), WF);
    logAction(makeAction({ tweetId: "t3", type: "retweet" }), WF);

    const store = readActionStore(WF);
    expect(store.actions).toHaveLength(3);
    expect(store.actions[0].tweetId).toBe("t1");
    expect(store.actions[1].tweetId).toBe("t2");
    expect(store.actions[2].tweetId).toBe("t3");
  });

  it("preserves existing actions when appending new ones", () => {
    // Seed with an initial action
    saveActionStore(makeStore({ actions: [makeAction({ tweetId: "existing" })] }), WF);

    logAction(makeAction({ tweetId: "new-action" }), WF);

    const store = readActionStore(WF);
    expect(store.actions).toHaveLength(2);
    expect(store.actions[0].tweetId).toBe("existing");
    expect(store.actions[1].tweetId).toBe("new-action");
  });
});

// --- hasEngaged ---

describe("hasEngaged", () => {
  it("returns false when no actions exist", () => {
    expect(hasEngaged("reply", "t1", WF)).toBe(false);
  });

  it("returns true when a matching type+tweetId exists", () => {
    logAction(makeAction({ type: "reply", tweetId: "t1" }), WF);

    expect(hasEngaged("reply", "t1", WF)).toBe(true);
  });

  it("returns false for a different action type on the same tweet", () => {
    logAction(makeAction({ type: "reply", tweetId: "t1" }), WF);

    // We replied to t1, but never liked it
    expect(hasEngaged("like", "t1", WF)).toBe(false);
  });

  it("returns false for the same action type on a different tweet", () => {
    logAction(makeAction({ type: "like", tweetId: "t1" }), WF);

    expect(hasEngaged("like", "t2", WF)).toBe(false);
  });

  it("returns true even after multiple actions of different types", () => {
    logAction(makeAction({ type: "reply", tweetId: "t1" }), WF);
    logAction(makeAction({ type: "like", tweetId: "t2" }), WF);
    logAction(makeAction({ type: "retweet", tweetId: "t3" }), WF);

    expect(hasEngaged("reply", "t1", WF)).toBe(true);
    expect(hasEngaged("like", "t2", WF)).toBe(true);
    expect(hasEngaged("retweet", "t3", WF)).toBe(true);
    expect(hasEngaged("follow", "t1", WF)).toBe(false);
  });
});

// --- getUnconsolidated ---

describe("getUnconsolidated", () => {
  it("returns empty array when no actions exist", () => {
    const result = getUnconsolidated(WF);
    expect(result).toEqual([]);
  });

  it("returns only unconsolidated actions", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ tweetId: "t1", consolidated: false, date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ tweetId: "t2", consolidated: true, date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ tweetId: "t3", consolidated: false, date: "2026-02-20T10:00:00.000Z" }),
      ],
    }), WF);

    const result = getUnconsolidated(WF);

    expect(result).toHaveLength(2);
    expect(result[0].tweetId).toBe("t1");
    expect(result[1].tweetId).toBe("t3");
  });

  it("filters by age when olderThanHours is specified", () => {
    // Current time: 2026-02-20T12:00:00Z
    // 6 hours ago:  2026-02-20T06:00:00Z
    saveActionStore(makeStore({
      actions: [
        // Old action — 10 hours ago (should be included with olderThanHours=6)
        makeAction({ tweetId: "old", consolidated: false, date: "2026-02-20T02:00:00.000Z" }),
        // Recent action — 1 hour ago (should be excluded with olderThanHours=6)
        makeAction({ tweetId: "recent", consolidated: false, date: "2026-02-20T11:00:00.000Z" }),
      ],
    }), WF);

    const result = getUnconsolidated(WF, 6);

    expect(result).toHaveLength(1);
    expect(result[0].tweetId).toBe("old");
  });

  it("returns all unconsolidated actions when olderThanHours is 0", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ tweetId: "t1", consolidated: false, date: "2026-02-20T11:59:59.000Z" }),
        makeAction({ tweetId: "t2", consolidated: false, date: "2026-02-20T11:00:00.000Z" }),
        makeAction({ tweetId: "t3", consolidated: true, date: "2026-02-20T10:00:00.000Z" }),
      ],
    }), WF);

    // olderThanHours=0 means cutoff is "now", so all unconsolidated actions with date <= now
    const result = getUnconsolidated(WF, 0);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.tweetId)).toEqual(["t1", "t2"]);
  });

  it("excludes future-dated unconsolidated actions", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ tweetId: "past", consolidated: false, date: "2026-02-20T11:00:00.000Z" }),
        // Hypothetical future action — date is after "now"
        makeAction({ tweetId: "future", consolidated: false, date: "2026-02-21T12:00:00.000Z" }),
      ],
    }), WF);

    const result = getUnconsolidated(WF);

    expect(result).toHaveLength(1);
    expect(result[0].tweetId).toBe("past");
  });
});

// --- markConsolidated ---

describe("markConsolidated", () => {
  it("marks unconsolidated actions before the given date as consolidated", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ tweetId: "t1", consolidated: false, date: "2026-02-19T10:00:00.000Z" }),
        makeAction({ tweetId: "t2", consolidated: false, date: "2026-02-20T08:00:00.000Z" }),
        makeAction({ tweetId: "t3", consolidated: false, date: "2026-02-20T14:00:00.000Z" }),
      ],
    }), WF);

    // Mark everything before noon as consolidated
    markConsolidated("2026-02-20T12:00:00.000Z", WF);

    const store = readActionStore(WF);
    expect(store.actions[0].consolidated).toBe(true);  // t1: before cutoff
    expect(store.actions[1].consolidated).toBe(true);  // t2: before cutoff
    expect(store.actions[2].consolidated).toBe(false); // t3: after cutoff
  });

  it("does not un-consolidate already consolidated actions", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ tweetId: "t1", consolidated: true, date: "2026-02-20T14:00:00.000Z" }),
      ],
    }), WF);

    // Mark with an earlier cutoff — should not affect already-consolidated actions
    markConsolidated("2026-02-20T10:00:00.000Z", WF);

    const store = readActionStore(WF);
    expect(store.actions[0].consolidated).toBe(true);
  });

  it("updates lastConsolidation to the current time", () => {
    saveActionStore(makeStore({
      actions: [makeAction({ consolidated: false, date: "2026-02-20T10:00:00.000Z" })],
      lastConsolidation: null,
    }), WF);

    markConsolidated("2026-02-20T12:00:00.000Z", WF);

    const store = readActionStore(WF);
    // Current fake time is 2026-02-20T12:00:00Z
    expect(store.lastConsolidation).toBe("2026-02-20T12:00:00.000Z");
  });

  it("handles empty action list without error", () => {
    saveActionStore(makeStore({ actions: [] }), WF);

    markConsolidated("2026-02-20T12:00:00.000Z", WF);

    const store = readActionStore(WF);
    expect(store.actions).toEqual([]);
    expect(store.lastConsolidation).toBe("2026-02-20T12:00:00.000Z");
  });
});

// --- getDailyStats ---

describe("getDailyStats", () => {
  it("returns empty object when no actions exist", () => {
    const stats = getDailyStats(WF);
    expect(stats).toEqual({});
  });

  it("aggregates action counts by day", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "reply", date: "2026-02-19T10:00:00.000Z" }),
        makeAction({ type: "reply", date: "2026-02-19T14:00:00.000Z" }),
        makeAction({ type: "like", date: "2026-02-19T11:00:00.000Z" }),
        makeAction({ type: "post", date: "2026-02-20T08:00:00.000Z" }),
        makeAction({ type: "follow", date: "2026-02-20T09:00:00.000Z" }),
        makeAction({ type: "retweet", date: "2026-02-20T10:00:00.000Z" }),
      ],
    }), WF);

    const stats = getDailyStats(WF);

    // Feb 19: 2 replies, 1 like
    expect(stats["2026-02-19"]).toEqual({
      replies: 2, likes: 1, posts: 0, follows: 0, retweets: 0,
    });
    // Feb 20: 1 post, 1 follow, 1 retweet
    expect(stats["2026-02-20"]).toEqual({
      replies: 0, likes: 0, posts: 1, follows: 1, retweets: 1,
    });
  });

  it("does not count skip actions in DayStats", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "skip", date: "2026-02-20T10:00:00.000Z", reason: "spam" }),
        makeAction({ type: "skip", date: "2026-02-20T11:00:00.000Z", reason: "irrelevant" }),
        makeAction({ type: "reply", date: "2026-02-20T12:00:00.000Z" }),
      ],
    }), WF);

    const stats = getDailyStats(WF);

    // Only the reply should count; skips are non-actions
    expect(stats["2026-02-20"]).toEqual({
      replies: 1, likes: 0, posts: 0, follows: 0, retweets: 0,
    });
  });

  it("handles multiple days with mixed action types", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "reply", date: "2026-02-18T10:00:00.000Z" }),
        makeAction({ type: "like", date: "2026-02-18T11:00:00.000Z" }),
        makeAction({ type: "like", date: "2026-02-18T12:00:00.000Z" }),
        makeAction({ type: "follow", date: "2026-02-19T10:00:00.000Z" }),
        makeAction({ type: "follow", date: "2026-02-19T11:00:00.000Z" }),
        makeAction({ type: "follow", date: "2026-02-19T12:00:00.000Z" }),
        makeAction({ type: "retweet", date: "2026-02-20T10:00:00.000Z" }),
      ],
    }), WF);

    const stats = getDailyStats(WF);

    expect(Object.keys(stats)).toHaveLength(3);
    expect(stats["2026-02-18"].replies).toBe(1);
    expect(stats["2026-02-18"].likes).toBe(2);
    expect(stats["2026-02-19"].follows).toBe(3);
    expect(stats["2026-02-20"].retweets).toBe(1);
  });
});

// --- getTodayCount ---

describe("getTodayCount", () => {
  it("returns 0 when no actions exist", () => {
    expect(getTodayCount("replies", WF)).toBe(0);
    expect(getTodayCount("likes", WF)).toBe(0);
    expect(getTodayCount("posts", WF)).toBe(0);
    expect(getTodayCount("follows", WF)).toBe(0);
    expect(getTodayCount("retweets", WF)).toBe(0);
  });

  it("returns correct count for today's actions only", () => {
    saveActionStore(makeStore({
      actions: [
        // Yesterday — should not be counted
        makeAction({ type: "reply", date: "2026-02-19T20:00:00.000Z" }),
        makeAction({ type: "reply", date: "2026-02-19T21:00:00.000Z" }),
        // Today (2026-02-20) — should be counted
        makeAction({ type: "reply", date: "2026-02-20T08:00:00.000Z" }),
        makeAction({ type: "reply", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "reply", date: "2026-02-20T11:00:00.000Z" }),
        makeAction({ type: "like", date: "2026-02-20T09:00:00.000Z" }),
      ],
    }), WF);

    expect(getTodayCount("replies", WF)).toBe(3);
    expect(getTodayCount("likes", WF)).toBe(1);
    expect(getTodayCount("posts", WF)).toBe(0);
  });

  it("returns 0 for today when all actions are from other days", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "reply", date: "2026-02-18T10:00:00.000Z" }),
        makeAction({ type: "like", date: "2026-02-19T10:00:00.000Z" }),
      ],
    }), WF);

    expect(getTodayCount("replies", WF)).toBe(0);
    expect(getTodayCount("likes", WF)).toBe(0);
  });
});

// --- getSkipPatterns ---

describe("getSkipPatterns", () => {
  it("returns empty string when no skip actions exist", () => {
    const result = getSkipPatterns(30, WF);
    expect(result).toBe("");
  });

  it("returns empty string when skip actions have no reasons", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "skip", reason: undefined, date: "2026-02-20T10:00:00.000Z" }),
      ],
    }), WF);

    const result = getSkipPatterns(30, WF);
    expect(result).toBe("");
  });

  it("tallies skip reasons and ranks them by frequency", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "skip", reason: "crypto spam", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "skip", reason: "self-promotion", date: "2026-02-20T10:01:00.000Z" }),
        makeAction({ type: "skip", reason: "crypto spam", date: "2026-02-20T10:02:00.000Z" }),
        makeAction({ type: "skip", reason: "crypto spam", date: "2026-02-20T10:03:00.000Z" }),
        makeAction({ type: "skip", reason: "off-topic", date: "2026-02-20T10:04:00.000Z" }),
        makeAction({ type: "skip", reason: "self-promotion", date: "2026-02-20T10:05:00.000Z" }),
      ],
    }), WF);

    const result = getSkipPatterns(30, WF);

    // crypto spam (3x) should appear before self-promotion (2x) and off-topic (1x)
    expect(result).toContain("crypto spam (3x)");
    expect(result).toContain("self-promotion (2x)");
    expect(result).toContain("off-topic (1x)");

    // Verify ordering: crypto spam should be first line
    const lines = result.split("\n");
    expect(lines[0]).toContain("crypto spam (3x)");
    expect(lines[1]).toContain("self-promotion (2x)");
    expect(lines[2]).toContain("off-topic (1x)");
  });

  it("limits to top 8 reasons", () => {
    // Create 10 distinct skip reasons with varying counts
    const actions: Action[] = [];
    for (let i = 1; i <= 10; i++) {
      for (let j = 0; j < i; j++) {
        actions.push(makeAction({
          type: "skip",
          reason: `reason-${i}`,
          date: "2026-02-20T10:00:00.000Z",
        }));
      }
    }
    saveActionStore(makeStore({ actions }), WF);

    const result = getSkipPatterns(200, WF);
    const lines = result.split("\n");

    // Should cap at 8 entries
    expect(lines).toHaveLength(8);
  });

  it("only considers the last N skip actions via the slice parameter", () => {
    // Older skips: lots of "spam"
    const actions: Action[] = [];
    for (let i = 0; i < 20; i++) {
      actions.push(makeAction({
        type: "skip",
        reason: "spam",
        date: "2026-02-20T08:00:00.000Z",
      }));
    }
    // Recent skips: "off-topic"
    for (let i = 0; i < 5; i++) {
      actions.push(makeAction({
        type: "skip",
        reason: "off-topic",
        date: "2026-02-20T10:00:00.000Z",
      }));
    }
    saveActionStore(makeStore({ actions }), WF);

    // Only look at the last 5 skip actions
    const result = getSkipPatterns(5, WF);

    expect(result).toContain("off-topic (5x)");
    expect(result).not.toContain("spam");
  });

  it("normalizes reasons to lowercase for deduplication", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "skip", reason: "Crypto Spam", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "skip", reason: "crypto spam", date: "2026-02-20T10:01:00.000Z" }),
        makeAction({ type: "skip", reason: "CRYPTO SPAM", date: "2026-02-20T10:02:00.000Z" }),
      ],
    }), WF);

    const result = getSkipPatterns(30, WF);

    // All three should be tallied under the same normalized key
    expect(result).toContain("crypto spam (3x)");
    const lines = result.split("\n");
    expect(lines).toHaveLength(1);
  });

  it("ignores non-skip action types", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "reply", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "like", date: "2026-02-20T10:01:00.000Z" }),
        makeAction({ type: "skip", reason: "low quality", date: "2026-02-20T10:02:00.000Z" }),
      ],
    }), WF);

    const result = getSkipPatterns(30, WF);

    expect(result).toContain("low quality (1x)");
    const lines = result.split("\n");
    expect(lines).toHaveLength(1);
  });
});

// --- getRecentReplies ---

describe("getRecentReplies", () => {
  it("returns 'No recent engagement history.' when no reply actions exist", () => {
    const result = getRecentReplies(10, WF);
    expect(result).toBe("No recent engagement history.");
  });

  it("returns 'No recent engagement history.' when only non-reply actions exist", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "like", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "skip", reason: "spam", date: "2026-02-20T10:01:00.000Z" }),
      ],
    }), WF);

    const result = getRecentReplies(10, WF);
    expect(result).toBe("No recent engagement history.");
  });

  it("formats recent replies with @username and truncated text", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({
          type: "reply",
          username: "alice",
          text: "Great insight on TypeScript generics!",
          date: "2026-02-20T10:00:00.000Z",
        }),
        makeAction({
          type: "reply",
          username: "bob",
          text: "Totally agree with your take on Rust.",
          date: "2026-02-20T11:00:00.000Z",
        }),
      ],
    }), WF);

    const result = getRecentReplies(10, WF);

    expect(result).toContain("@alice");
    expect(result).toContain("Great insight on TypeScript generics!");
    expect(result).toContain("@bob");
    expect(result).toContain("Totally agree with your take on Rust.");
  });

  it("limits to the last N replies", () => {
    const actions: Action[] = [];
    for (let i = 1; i <= 20; i++) {
      actions.push(makeAction({
        type: "reply",
        username: `user${i}`,
        text: `Reply number ${i}`,
        date: `2026-02-20T${String(i).padStart(2, "0")}:00:00.000Z`,
      }));
    }
    saveActionStore(makeStore({ actions }), WF);

    const result = getRecentReplies(3, WF);

    // Should only contain the last 3 replies (user18, user19, user20)
    expect(result).toContain("@user18");
    expect(result).toContain("@user19");
    expect(result).toContain("@user20");
    expect(result).not.toContain("@user17");
  });

  it("truncates reply text to 80 characters", () => {
    const longText = "A".repeat(120);

    saveActionStore(makeStore({
      actions: [
        makeAction({
          type: "reply",
          username: "verbose",
          text: longText,
          date: "2026-02-20T10:00:00.000Z",
        }),
      ],
    }), WF);

    const result = getRecentReplies(10, WF);

    // The text should be sliced to 80 characters + "..."
    expect(result).toContain("A".repeat(80));
    expect(result).toContain("...");
    // Should not contain the full 120-char string
    expect(result).not.toContain("A".repeat(81));
  });

  it("skips replies that are missing username or text", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "reply", username: undefined, text: "No username", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "reply", username: "alice", text: undefined, date: "2026-02-20T10:01:00.000Z" }),
        makeAction({ type: "reply", username: "bob", text: "Valid reply", date: "2026-02-20T10:02:00.000Z" }),
      ],
    }), WF);

    const result = getRecentReplies(10, WF);

    // Only the valid reply should appear
    expect(result).toContain("@bob");
    expect(result).toContain("Valid reply");
    expect(result).not.toContain("@alice");
    expect(result).not.toContain("No username");
  });
});

// --- Cross-Workflow Isolation ---

describe("cross-workflow isolation", () => {
  const WF2 = "other-wf";

  beforeEach(() => {
    mkdirSync(join(workspace.workflowsDir, WF2), { recursive: true });
  });

  it("actions logged in one workflow are not visible in another", () => {
    logAction(makeAction({ tweetId: "t1", type: "reply" }), WF);
    logAction(makeAction({ tweetId: "t2", type: "like" }), WF2);

    // WF should only see t1
    expect(hasEngaged("reply", "t1", WF)).toBe(true);
    expect(hasEngaged("like", "t2", WF)).toBe(false);

    // WF2 should only see t2
    expect(hasEngaged("like", "t2", WF2)).toBe(true);
    expect(hasEngaged("reply", "t1", WF2)).toBe(false);
  });

  it("getDailyStats are scoped to the workflow", () => {
    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "reply", date: "2026-02-20T10:00:00.000Z" }),
        makeAction({ type: "reply", date: "2026-02-20T11:00:00.000Z" }),
      ],
    }), WF);

    saveActionStore(makeStore({
      actions: [
        makeAction({ type: "like", date: "2026-02-20T10:00:00.000Z" }),
      ],
    }), WF2);

    const statsWF = getDailyStats(WF);
    const statsWF2 = getDailyStats(WF2);

    expect(statsWF["2026-02-20"].replies).toBe(2);
    expect(statsWF["2026-02-20"].likes).toBe(0);
    expect(statsWF2["2026-02-20"].likes).toBe(1);
    expect(statsWF2["2026-02-20"].replies).toBe(0);
  });
});
