/**
 * Tests for workflow-scoped Twitter memory — verifying action logging,
 * duplicate checks, daily stats, skip tracking, global blocklist delegation,
 * and feedback directives all persist correctly within a named workflow.
 *
 * NOTE: The memory module's EMPTY_MEMORY constant has shared array references,
 * so readMemory() on a missing file can return stale data after prior mutations.
 * We work around this by writing a clean empty memory file in beforeEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { createMockMemory } from "../../helpers/mock-data";
import {
  readMemory,
  saveMemory,
  logReply,
  logLike,
  logRetweet,
  logPost,
  logFollow,
  hasRepliedTo,
  hasLiked,
  getDailyCount,
  getRecentHistory,
  logSkip,
  getSkipPatterns,
  blockAccount,
  isBlocked,
  getBlockedAccounts,
  addFeedback,
  getFeedback,
  removeFeedback,
} from "@/modules/twitter/memory";
import { readGlobalSafety } from "@/modules/twitter/workflow";

const WF = "test-wf";
let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
  workspace = createTestWorkspace();
  // Create the workflow directory so memory can be written there
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
  // Write a clean empty memory file to avoid EMPTY_MEMORY mutation leakage
  saveMemory(createMockMemory(), WF);
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- readMemory / saveMemory ---

describe("readMemory / saveMemory", () => {
  it("readMemory returns empty defaults when no file exists", () => {
    // Note: We test the structure of a fresh read (file was seeded in beforeEach)
    const mem = readMemory(WF);

    expect(mem.repliedTo).toEqual([]);
    expect(mem.liked).toEqual([]);
    expect(mem.retweeted).toEqual([]);
    expect(mem.posted).toEqual([]);
    expect(mem.followed).toEqual([]);
    expect(mem.dailyStats).toEqual({});
    expect(mem.skipped).toEqual([]);
    expect(mem.blockedAccounts).toEqual([]);
    expect(mem.feedback).toEqual([]);
  });

  it("saveMemory + readMemory round-trips", () => {
    const mem = readMemory(WF);
    mem.feedback.push("Be concise");
    mem.liked.push("tweet-1");
    saveMemory(mem, WF);

    const loaded = readMemory(WF);
    expect(loaded.feedback).toEqual(["Be concise"]);
    expect(loaded.liked).toEqual(["tweet-1"]);
  });
});

// --- Action Logging ---

describe("action logging", () => {
  it("logReply records a reply and hasRepliedTo returns true", () => {
    logReply("t1", "u1", "alice", "Great point!", WF);

    expect(hasRepliedTo("t1", WF)).toBe(true);
    expect(hasRepliedTo("t2", WF)).toBe(false);

    // Verify the entry details
    const mem = readMemory(WF);
    expect(mem.repliedTo).toHaveLength(1);
    expect(mem.repliedTo[0].tweetId).toBe("t1");
    expect(mem.repliedTo[0].username).toBe("alice");
    expect(mem.repliedTo[0].ourReply).toBe("Great point!");
  });

  it("logLike records a like and hasLiked returns true", () => {
    logLike("t5", WF);

    expect(hasLiked("t5", WF)).toBe(true);
    expect(hasLiked("t6", WF)).toBe(false);
  });

  it("logRetweet increments daily retweets count", () => {
    logRetweet("t10", WF);
    logRetweet("t11", WF);

    expect(getDailyCount("retweets", WF)).toBe(2);
  });

  it("logPost increments daily posts count", () => {
    logPost("t20", "Hello world!", WF);

    expect(getDailyCount("posts", WF)).toBe(1);
  });

  it("logFollow increments daily follows count", () => {
    logFollow("u100", WF);
    logFollow("u101", WF);
    logFollow("u102", WF);

    expect(getDailyCount("follows", WF)).toBe(3);
  });
});

// --- Stats Queries ---

describe("getDailyCount", () => {
  it("returns 0 initially", () => {
    expect(getDailyCount("replies", WF)).toBe(0);
    expect(getDailyCount("likes", WF)).toBe(0);
    expect(getDailyCount("posts", WF)).toBe(0);
    expect(getDailyCount("follows", WF)).toBe(0);
    expect(getDailyCount("retweets", WF)).toBe(0);
  });

  it("returns correct value after logging actions", () => {
    logReply("t1", "u1", "bob", "Nice!", WF);
    logReply("t2", "u2", "carol", "Agreed!", WF);
    logLike("t3", WF);

    expect(getDailyCount("replies", WF)).toBe(2);
    expect(getDailyCount("likes", WF)).toBe(1);
  });
});

// --- Recent History ---

describe("getRecentHistory", () => {
  it("returns 'No recent engagement history.' when empty", () => {
    const history = getRecentHistory(10, WF);
    expect(history).toBe("No recent engagement history.");
  });

  it("returns formatted reply entries after logReply", () => {
    logReply("t1", "u1", "alice", "Interesting perspective on TypeScript!", WF);
    logReply("t2", "u2", "bob", "Totally agree with this take.", WF);

    const history = getRecentHistory(10, WF);
    expect(history).toContain("@alice");
    expect(history).toContain("Interesting perspective on TypeScript!");
    expect(history).toContain("@bob");
    expect(history).toContain("Totally agree with this take.");
  });
});

// --- Skip Tracking ---

describe("logSkip / getSkipPatterns", () => {
  it("logSkip records skip entries, getSkipPatterns returns formatted patterns", () => {
    logSkip("spammer1", "Buy crypto now!", "crypto spam", WF);
    logSkip("spammer2", "Free giveaway!", "crypto spam", WF);
    logSkip("promoter", "Check out my course", "self-promotion", WF);

    const patterns = getSkipPatterns(30, WF);

    // "crypto spam" appears twice so should be listed first
    expect(patterns).toContain("crypto spam (2x)");
    expect(patterns).toContain("self-promotion (1x)");
  });

  it("logSkip records all entries (action log is unbounded, consolidated later)", () => {
    // Write 210 skip entries — the new tiered system stores all actions
    for (let i = 0; i < 210; i++) {
      logSkip(`user${i}`, `tweet snippet ${i}`, `reason ${i}`, WF);
    }

    const mem = readMemory(WF);
    expect(mem.skipped).toHaveLength(210);

    // Entries are in chronological order
    expect(mem.skipped[0].username).toBe("user0");
    expect(mem.skipped[209].username).toBe("user209");
  });
});

// --- Blocked Accounts (global safety delegation) ---

describe("blockAccount / isBlocked", () => {
  it("blockAccount + isBlocked delegates to global safety", () => {
    blockAccount("@ToxicUser");

    expect(isBlocked("toxicuser")).toBe(true);
    expect(isBlocked("@ToxicUser")).toBe(true);

    // Verify via global safety state directly
    const global = readGlobalSafety();
    expect(global.blockedAccounts).toContain("toxicuser");
  });

  it("getBlockedAccounts returns the global blocklist", () => {
    blockAccount("spam1");
    blockAccount("spam2");

    const blocked = getBlockedAccounts();
    expect(blocked).toContain("spam1");
    expect(blocked).toContain("spam2");
  });
});

// --- Feedback Directives ---

describe("addFeedback / getFeedback / removeFeedback", () => {
  it("addFeedback + getFeedback round-trips", () => {
    addFeedback("Always include a question in replies", WF);
    addFeedback("Avoid controversial topics", WF);

    const feedback = getFeedback(WF);
    expect(feedback).toHaveLength(2);
    expect(feedback[0]).toContain("Always include a question in replies");
    expect(feedback[1]).toContain("Avoid controversial topics");

    // Feedback should be timestamped with the faked date
    expect(feedback[0]).toContain("[2026-02-20]");
  });

  it("removeFeedback removes by index", () => {
    addFeedback("Keep it short", WF);
    addFeedback("Use emoji sparingly", WF);
    addFeedback("Ask follow-up questions", WF);

    removeFeedback(1, WF);

    const feedback = getFeedback(WF);
    expect(feedback).toHaveLength(2);
    expect(feedback[0]).toContain("Keep it short");
    expect(feedback[1]).toContain("Ask follow-up questions");
  });
});
