/**
 * Tests for memory.working.ts — the working memory assembler and prompt formatter.
 *
 * Verifies that buildWorkingMemory() correctly pulls from all four storage
 * layers (actions, facts, observations, relationships) and that
 * formatWorkingMemoryForPrompt() renders the assembled data into a prompt-ready
 * markdown string with all expected sections.
 *
 * Uses real filesystem via createTestWorkspace, seeding data through the
 * storage modules' public write functions. Fake timers pin "now" to
 * 2026-02-20T12:00:00Z so date-dependent aggregation is deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  buildWorkingMemory,
  formatWorkingMemoryForPrompt,
} from "@/modules/twitter/memory.working";
import { logAction, readActionStore, saveActionStore } from "@/modules/twitter/memory.actions";
import { addFact } from "@/modules/twitter/memory.facts";
import { addObservation } from "@/modules/twitter/memory.observations";
import { recordInteraction, applyRelationshipUpdates } from "@/modules/twitter/memory.relationships";
import type { Action, WorkingMemory } from "@/modules/twitter/memory.types";

const WF = "test-wf";
let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
  workspace = createTestWorkspace();
  // Create the workflow directory so all stores can write there
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- Helper: Seed Actions ---

/** Seed a batch of actions into the action store for a given workflow */
function seedAction(type: Action["type"], date: string, extra?: Partial<Action>): void {
  logAction(
    {
      type,
      date,
      consolidated: false,
      ...extra,
    },
    WF,
  );
}

/** Seed directives directly into the action store */
function seedDirectives(directives: string[]): void {
  // Read existing store, add directives, save back
  const store = readActionStore(WF);
  store.directives.push(...directives);
  saveActionStore(store, WF);
}

// --- buildWorkingMemory ---

describe("buildWorkingMemory", () => {
  // --- Empty State ---

  describe("empty state", () => {
    it("returns zero performance when no data exists", () => {
      const wm = buildWorkingMemory(WF);

      expect(wm.performance.totalActions).toBe(0);
      expect(wm.performance.replies).toBe(0);
      expect(wm.performance.likes).toBe(0);
      expect(wm.performance.follows).toBe(0);
      expect(wm.performance.skips).toBe(0);
      expect(wm.performance.skipRate).toBe(0);
    });

    it("returns empty arrays for facts, observations, relationships", () => {
      const wm = buildWorkingMemory(WF);

      expect(wm.facts).toEqual([]);
      expect(wm.observations).toEqual([]);
      expect(wm.relationships).toEqual([]);
    });

    it("returns empty directives and skipPatterns", () => {
      const wm = buildWorkingMemory(WF);

      expect(wm.directives).toEqual([]);
      expect(wm.skipPatterns).toBe("");
    });
  });

  // --- 7-Day Performance Aggregation ---

  describe("7-day performance aggregation", () => {
    it("aggregates actions within the last 7 days", () => {
      // Seed actions across multiple days within the 7-day window
      // Current date: 2026-02-20, so cutoff is 2026-02-13
      seedAction("reply", "2026-02-14T10:00:00Z", { tweetId: "t1", username: "alice", text: "Great!" });
      seedAction("reply", "2026-02-18T10:00:00Z", { tweetId: "t2", username: "bob", text: "Nice!" });
      seedAction("reply", "2026-02-20T09:00:00Z", { tweetId: "t3", username: "carol", text: "Agreed!" });
      seedAction("like", "2026-02-15T10:00:00Z", { tweetId: "t4" });
      seedAction("like", "2026-02-19T10:00:00Z", { tweetId: "t5" });
      seedAction("follow", "2026-02-17T10:00:00Z", { userId: "u1" });

      const wm = buildWorkingMemory(WF);

      expect(wm.performance.replies).toBe(3);
      expect(wm.performance.likes).toBe(2);
      expect(wm.performance.follows).toBe(1);
      // totalActions = 3 replies + 2 likes + 1 follow = 6 (no skips)
      expect(wm.performance.totalActions).toBe(6);
    });

    it("excludes actions older than 7 days from performance", () => {
      // Seed an action exactly 8 days ago — should be excluded
      seedAction("reply", "2026-02-12T10:00:00Z", { tweetId: "t-old", username: "old", text: "Old" });
      // Seed an action within the window
      seedAction("reply", "2026-02-14T10:00:00Z", { tweetId: "t-new", username: "new", text: "New" });

      const wm = buildWorkingMemory(WF);

      expect(wm.performance.replies).toBe(1);
      expect(wm.performance.totalActions).toBe(1);
    });

    it("includes the correct period string", () => {
      seedAction("like", "2026-02-20T08:00:00Z", { tweetId: "t1" });

      const wm = buildWorkingMemory(WF);

      // Period should be "2026-02-13 to 2026-02-20"
      expect(wm.performance.period).toBe("2026-02-13 to 2026-02-20");
    });
  });

  // --- Skip Rate ---

  describe("skipRate computation", () => {
    it("computes skipRate as fraction of total actions", () => {
      // 2 replies + 1 like + 3 skips = 6 total, skipRate = 3/6 = 0.5
      seedAction("reply", "2026-02-20T09:00:00Z", { tweetId: "t1", username: "a", text: "hi" });
      seedAction("reply", "2026-02-20T09:01:00Z", { tweetId: "t2", username: "b", text: "yo" });
      seedAction("like", "2026-02-20T09:02:00Z", { tweetId: "t3" });
      seedAction("skip", "2026-02-20T09:03:00Z", { tweetId: "t4", reason: "spam" });
      seedAction("skip", "2026-02-20T09:04:00Z", { tweetId: "t5", reason: "off-topic" });
      seedAction("skip", "2026-02-20T09:05:00Z", { tweetId: "t6", reason: "spam" });

      const wm = buildWorkingMemory(WF);

      expect(wm.performance.skips).toBe(3);
      expect(wm.performance.totalActions).toBe(6);
      expect(wm.performance.skipRate).toBe(0.5);
    });

    it("returns skipRate 0 when there are no actions", () => {
      const wm = buildWorkingMemory(WF);
      expect(wm.performance.skipRate).toBe(0);
    });

    it("returns skipRate 1 when all actions are skips", () => {
      seedAction("skip", "2026-02-20T09:00:00Z", { tweetId: "s1", reason: "spam" });
      seedAction("skip", "2026-02-20T09:01:00Z", { tweetId: "s2", reason: "spam" });

      const wm = buildWorkingMemory(WF);

      expect(wm.performance.skipRate).toBe(1);
      expect(wm.performance.totalActions).toBe(2);
    });

    it("rounds skipRate to 2 decimal places", () => {
      // 1 reply + 2 skips = 3 total, skipRate = 2/3 = 0.666... -> 0.67
      seedAction("reply", "2026-02-20T09:00:00Z", { tweetId: "t1", username: "a", text: "hi" });
      seedAction("skip", "2026-02-20T09:01:00Z", { tweetId: "s1", reason: "spam" });
      seedAction("skip", "2026-02-20T09:02:00Z", { tweetId: "s2", reason: "off-topic" });

      const wm = buildWorkingMemory(WF);

      expect(wm.performance.skipRate).toBe(0.67);
    });
  });

  // --- Facts ---

  describe("facts from fact store", () => {
    it("includes facts seeded via addFact", () => {
      addFact("Replies with questions get 3x engagement", "strategy", "high", WF);
      addFact("Best posting time is 9-11am PST", "timing", "medium", WF);

      const wm = buildWorkingMemory(WF);

      expect(wm.facts).toHaveLength(2);
      expect(wm.facts[0].content).toBe("Replies with questions get 3x engagement");
      // High confidence should sort first
      expect(wm.facts[0].confidence).toBe("high");
    });

    it("caps facts at 15 entries", () => {
      for (let i = 0; i < 20; i++) {
        addFact(`Fact number ${i}`, "strategy", "medium", WF);
      }

      const wm = buildWorkingMemory(WF);

      expect(wm.facts).toHaveLength(15);
    });
  });

  // --- Observations ---

  describe("observations from observation store", () => {
    it("includes observations seeded via addObservation", () => {
      addObservation(
        {
          date: "2026-02-20",
          sessionId: "s1",
          content: "AI threads performed well today",
          priority: 8,
        },
        WF,
      );
      addObservation(
        {
          date: "2026-02-19",
          sessionId: "s2",
          content: "Engagement dropped in the afternoon",
          priority: 5,
        },
        WF,
      );

      const wm = buildWorkingMemory(WF);

      expect(wm.observations).toHaveLength(2);
      // Sorted by date descending — most recent first
      expect(wm.observations[0].content).toBe("AI threads performed well today");
      expect(wm.observations[1].content).toBe("Engagement dropped in the afternoon");
    });

    it("caps observations at 5 entries", () => {
      for (let i = 0; i < 8; i++) {
        addObservation(
          {
            date: `2026-02-${String(13 + i).padStart(2, "0")}`,
            sessionId: `s${i}`,
            content: `Observation ${i}`,
            priority: 5,
          },
          WF,
        );
      }

      const wm = buildWorkingMemory(WF);

      expect(wm.observations).toHaveLength(5);
    });
  });

  // --- Relationships ---

  describe("relationships from relationship store", () => {
    it("includes relationships seeded via recordInteraction", () => {
      recordInteraction("alice", "our-reply", WF);
      recordInteraction("bob", "our-like", WF);

      const wm = buildWorkingMemory(WF);

      expect(wm.relationships).toHaveLength(2);
      const usernames = wm.relationships.map((r) => r.username);
      expect(usernames).toContain("alice");
      expect(usernames).toContain("bob");
    });

    it("reflects warmth tiers based on interaction count", () => {
      // 7+ interactions = hot
      for (let i = 0; i < 8; i++) {
        recordInteraction("hot-user", "our-reply", WF);
      }
      // 3-6 interactions = warm
      for (let i = 0; i < 4; i++) {
        recordInteraction("warm-user", "our-like", WF);
      }
      // 1-2 interactions = cold
      recordInteraction("cold-user", "their-mention", WF);

      const wm = buildWorkingMemory(WF);

      const hotUser = wm.relationships.find((r) => r.username === "hot-user");
      const warmUser = wm.relationships.find((r) => r.username === "warm-user");
      const coldUser = wm.relationships.find((r) => r.username === "cold-user");

      expect(hotUser?.warmth).toBe("hot");
      expect(warmUser?.warmth).toBe("warm");
      expect(coldUser?.warmth).toBe("cold");
    });

    it("caps relationships at 10 entries", () => {
      for (let i = 0; i < 15; i++) {
        recordInteraction(`user${i}`, "our-reply", WF);
      }

      const wm = buildWorkingMemory(WF);

      expect(wm.relationships).toHaveLength(10);
    });
  });

  // --- Directives ---

  describe("directives from action store", () => {
    it("includes directives stored in the action store", () => {
      seedDirectives(["Be concise", "Avoid crypto topics"]);

      const wm = buildWorkingMemory(WF);

      expect(wm.directives).toHaveLength(2);
      expect(wm.directives).toContain("Be concise");
      expect(wm.directives).toContain("Avoid crypto topics");
    });

    it("returns empty directives when none are stored", () => {
      const wm = buildWorkingMemory(WF);

      expect(wm.directives).toEqual([]);
    });
  });

  // --- Skip Patterns ---

  describe("skipPatterns from action store", () => {
    it("aggregates skip reasons into pattern string", () => {
      seedAction("skip", "2026-02-20T09:00:00Z", { tweetId: "s1", reason: "crypto spam" });
      seedAction("skip", "2026-02-20T09:01:00Z", { tweetId: "s2", reason: "crypto spam" });
      seedAction("skip", "2026-02-20T09:02:00Z", { tweetId: "s3", reason: "self-promotion" });

      const wm = buildWorkingMemory(WF);

      expect(wm.skipPatterns).toContain("crypto spam (2x)");
      expect(wm.skipPatterns).toContain("self-promotion (1x)");
    });

    it("returns empty string when no skips exist", () => {
      const wm = buildWorkingMemory(WF);

      expect(wm.skipPatterns).toBe("");
    });
  });
});

// --- formatWorkingMemoryForPrompt ---

describe("formatWorkingMemoryForPrompt", () => {
  // --- Empty / No Data ---

  describe("empty working memory", () => {
    it("returns 'No memory data yet' when all sections are empty", () => {
      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toBe("No memory data yet — this is a new workflow.");
    });
  });

  // --- Full Output With All Sections ---

  describe("with populated data", () => {
    let wm: WorkingMemory;

    beforeEach(() => {
      // Seed actions for performance
      seedAction("reply", "2026-02-20T09:00:00Z", { tweetId: "t1", username: "alice", text: "Great!" });
      seedAction("reply", "2026-02-20T09:01:00Z", { tweetId: "t2", username: "bob", text: "Nice!" });
      seedAction("like", "2026-02-20T09:02:00Z", { tweetId: "t3" });
      seedAction("follow", "2026-02-20T09:03:00Z", { userId: "u1" });
      seedAction("skip", "2026-02-20T09:04:00Z", { tweetId: "t4", reason: "spam" });

      // Seed facts
      addFact("Questions in replies boost engagement", "strategy", "high", WF);

      // Seed observations
      addObservation(
        {
          date: "2026-02-20",
          sessionId: "s1",
          content: "AI threads performed well",
          priority: 8,
        },
        WF,
      );

      // Seed relationships
      recordInteraction("alice", "our-reply", WF);

      // Seed directives
      seedDirectives(["Always ask a follow-up question"]);

      wm = buildWorkingMemory(WF);
    });

    it("includes the Performance section", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### Performance (last 7 days)");
      expect(output).toContain("2 replies");
      expect(output).toContain("1 likes");
      expect(output).toContain("1 follows");
      expect(output).toContain("1 skips");
      expect(output).toContain("5 total actions");
    });

    it("includes the Known Facts section", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### Known Facts");
      expect(output).toContain("[high] Questions in replies boost engagement");
    });

    it("includes the Recent Session Notes section", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### Recent Session Notes");
      expect(output).toContain("[2026-02-20] AI threads performed well");
    });

    it("includes the Key Relationships section", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### Key Relationships");
      expect(output).toContain("@alice");
      expect(output).toContain("1 interactions");
    });

    it("includes the User Directives section", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### User Directives");
      expect(output).toContain("Always ask a follow-up question");
      expect(output).toContain("Follow these directives strictly");
    });

    it("includes the Learned Skip Patterns section", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### Learned Skip Patterns");
      expect(output).toContain("spam (1x)");
      expect(output).toContain("Skip tweets matching these patterns proactively");
    });

    it("separates sections with double newlines", () => {
      const output = formatWorkingMemoryForPrompt(wm);

      // Each section header should be preceded by a double newline (except the first)
      const sections = output.split("\n\n");
      // With all 6 sections populated, we should have 6 pieces
      expect(sections.length).toBe(6);
    });
  });

  // --- Partial Data ---

  describe("partial data (only some sections populated)", () => {
    it("includes only Performance when only actions exist", () => {
      seedAction("reply", "2026-02-20T09:00:00Z", { tweetId: "t1", username: "a", text: "hi" });

      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("### Performance (last 7 days)");
      expect(output).not.toContain("### Known Facts");
      expect(output).not.toContain("### Recent Session Notes");
      expect(output).not.toContain("### Key Relationships");
      expect(output).not.toContain("### User Directives");
    });

    it("includes only Facts when only facts exist", () => {
      addFact("Testing insight", "strategy", "medium", WF);

      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      // No actions means no performance section
      expect(output).not.toContain("### Performance");
      expect(output).toContain("### Known Facts");
      expect(output).toContain("[medium] Testing insight");
    });
  });

  // --- Relationships Display Cap ---

  describe("relationships display formatting", () => {
    it("shows warmth badge correctly for hot, warm, and cold accounts", () => {
      // Hot user: 7+ interactions
      for (let i = 0; i < 8; i++) {
        recordInteraction("power-user", "our-reply", WF);
      }
      // Warm user: 3-6 interactions
      for (let i = 0; i < 4; i++) {
        recordInteraction("regular-user", "our-like", WF);
      }
      // Cold user: 1-2 interactions
      recordInteraction("new-user", "their-mention", WF);

      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("**HOT**");
      expect(output).toContain("warm");
      expect(output).toContain("cold");
    });

    it("caps displayed relationships at 10 in the formatted output", () => {
      // Create 15 accounts — only 10 should appear in relationships
      for (let i = 0; i < 15; i++) {
        recordInteraction(`user-${i}`, "our-reply", WF);
      }

      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      // Count the number of relationship lines (each starts with "- @")
      const relLines = output.split("\n").filter((line) => line.startsWith("- @"));
      expect(relLines).toHaveLength(10);
    });

    it("displays topics in parentheses, capped at 3", () => {
      // Create a relationship, then add topics via applyRelationshipUpdates
      recordInteraction("topical-user", "our-reply", WF);
      applyRelationshipUpdates(
        [
          {
            username: "topical-user",
            topicsToAdd: ["typescript", "react", "nodejs", "rust", "python"],
          },
        ],
        WF,
      );

      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      // Should show at most 3 topics
      expect(output).toContain("(typescript, react, nodejs)");
      // The 4th and 5th topics should not appear in the formatted line
      expect(output).not.toContain("rust");
      expect(output).not.toContain("python");
    });
  });

  // --- Skip Rate Display ---

  describe("skip rate display in performance section", () => {
    it("displays skip rate as a percentage", () => {
      // 1 reply + 1 skip = 50% skip rate
      seedAction("reply", "2026-02-20T09:00:00Z", { tweetId: "t1", username: "a", text: "hi" });
      seedAction("skip", "2026-02-20T09:01:00Z", { tweetId: "s1", reason: "spam" });

      const wm = buildWorkingMemory(WF);
      const output = formatWorkingMemoryForPrompt(wm);

      expect(output).toContain("50% skip rate");
    });
  });
});
