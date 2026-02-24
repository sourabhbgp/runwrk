/**
 * memory-lifecycle.test.ts — Integration tests for the tiered memory system.
 *
 * Exercises the full lifecycle of each memory layer (actions, facts, observations,
 * relationships) against real filesystem in isolated temp directories. Each test
 * gets a fresh workspace with a pre-written workflow config via createTestWorkspace.
 *
 * Also tests the Stage 2 migration path (memory.json -> actions.json) and the
 * working memory assembly that pulls from all four stores into a single prompt block.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { createMockWorkflowConfig } from "../../helpers/mock-data";
import { writeWorkflowConfig } from "@/modules/twitter/workflow";
import { logReply, logLike, logSkip, readMemory, getWorkingMemoryBlock } from "@/modules/twitter/memory";
import { readActionStore } from "@/modules/twitter/memory.actions";
import { addFact, updateFact, deleteFact, getTopFacts } from "@/modules/twitter/memory.facts";
import { recordInteraction, readRelationshipStore } from "@/modules/twitter/memory.relationships";
import { addObservation } from "@/modules/twitter/memory.observations";
import { ensureMigrated } from "@/modules/twitter/workflow.migrate";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const WORKFLOW_NAME = "test-memory";

describe("Tiered memory lifecycle", () => {
  let workspace: TestWorkspace;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));

    workspace = createTestWorkspace();

    // Write a workflow config so the workflow directory exists before tests
    const config = createMockWorkflowConfig({
      name: WORKFLOW_NAME,
      description: "Memory lifecycle test workflow",
      template: "custom",
    });
    writeWorkflowConfig(WORKFLOW_NAME, config);
  });

  afterEach(() => {
    vi.useRealTimers();
    workspace.cleanup();
  });

  // --- 1. Action Logging Lifecycle ---

  describe("Action logging lifecycle", () => {
    it("logs replies, likes, and skips via facade and verifies in readMemory and readActionStore", () => {
      // Log several actions through the public facade
      logReply("tweet-001", "user-A", "alice", "Great point about TypeScript!", WORKFLOW_NAME);
      logReply("tweet-002", "user-B", "bob", "Totally agree with this take.", WORKFLOW_NAME);
      logLike("tweet-003", WORKFLOW_NAME);
      logLike("tweet-004", WORKFLOW_NAME);
      logLike("tweet-005", WORKFLOW_NAME);
      logSkip("charlie", "Hot take about frameworks...", "off-topic", WORKFLOW_NAME);
      logSkip("dave", "Buy my course!", "spam", WORKFLOW_NAME);

      // Verify via the high-level readMemory() facade
      const mem = readMemory(WORKFLOW_NAME);
      expect(mem.repliedTo).toHaveLength(2);
      expect(mem.repliedTo[0].tweetId).toBe("tweet-001");
      expect(mem.repliedTo[0].username).toBe("alice");
      expect(mem.repliedTo[0].ourReply).toBe("Great point about TypeScript!");
      expect(mem.repliedTo[1].tweetId).toBe("tweet-002");
      expect(mem.liked).toHaveLength(3);
      expect(mem.liked).toEqual(["tweet-003", "tweet-004", "tweet-005"]);
      expect(mem.skipped).toHaveLength(2);
      expect(mem.skipped[0].username).toBe("charlie");
      expect(mem.skipped[0].reason).toBe("off-topic");
      expect(mem.skipped[1].username).toBe("dave");
      expect(mem.skipped[1].reason).toBe("spam");

      // Verify via the low-level readActionStore() from memory.actions
      const store = readActionStore(WORKFLOW_NAME);
      expect(store.actions).toHaveLength(7); // 2 replies + 3 likes + 2 skips
      const replies = store.actions.filter((a) => a.type === "reply");
      expect(replies).toHaveLength(2);
      expect(replies[0].text).toBe("Great point about TypeScript!");
      const likes = store.actions.filter((a) => a.type === "like");
      expect(likes).toHaveLength(3);
      const skips = store.actions.filter((a) => a.type === "skip");
      expect(skips).toHaveLength(2);
      expect(skips[0].reason).toBe("off-topic");

      // All actions should be unconsolidated
      for (const action of store.actions) {
        expect(action.consolidated).toBe(false);
      }

      // Dates should match the fake timer
      for (const action of store.actions) {
        expect(action.date).toBe("2026-02-20T12:00:00.000Z");
      }
    });
  });

  // --- 2. Fact Store Lifecycle ---

  describe("Fact store lifecycle", () => {
    it("adds, updates, deletes facts and verifies getTopFacts returns correct results", () => {
      // Add three facts with varying confidence levels
      const factA = addFact(
        "Replies with questions get 3x more engagement",
        "strategy",
        "high",
        WORKFLOW_NAME,
      );
      const factB = addFact(
        "Best engagement happens 9-11am PST",
        "timing",
        "medium",
        WORKFLOW_NAME,
      );
      const factC = addFact(
        "@alice is interested in TypeScript and Rust",
        "account",
        "low",
        WORKFLOW_NAME,
      );

      // Verify all three are returned by getTopFacts
      const allFacts = getTopFacts(10, WORKFLOW_NAME);
      expect(allFacts).toHaveLength(3);

      // Facts should be sorted by confidence (high > medium > low)
      expect(allFacts[0].content).toBe("Replies with questions get 3x more engagement");
      expect(allFacts[1].content).toBe("Best engagement happens 9-11am PST");
      expect(allFacts[2].content).toBe("@alice is interested in TypeScript and Rust");

      // Update factB to high confidence and change content
      const updated = updateFact(
        factB.id,
        { content: "Peak engagement is 10-11am PST", confidence: "high" },
        WORKFLOW_NAME,
      );
      expect(updated).toBe(true);

      // After update, both high-confidence facts should appear before low
      const afterUpdate = getTopFacts(10, WORKFLOW_NAME);
      expect(afterUpdate).toHaveLength(3);
      // Both high-confidence facts appear first (factA and updated factB)
      const highFacts = afterUpdate.filter((f) => f.confidence === "high");
      expect(highFacts).toHaveLength(2);
      expect(highFacts.some((f) => f.content === "Peak engagement is 10-11am PST")).toBe(true);

      // Delete factC
      const deleted = deleteFact(factC.id, WORKFLOW_NAME);
      expect(deleted).toBe(true);

      // Verify only two facts remain
      const afterDelete = getTopFacts(10, WORKFLOW_NAME);
      expect(afterDelete).toHaveLength(2);
      expect(afterDelete.some((f) => f.id === factC.id)).toBe(false);

      // Deleting a non-existent fact returns false
      expect(deleteFact("non-existent-id", WORKFLOW_NAME)).toBe(false);
    });
  });

  // --- 3. Relationship Tracking Lifecycle ---

  describe("Relationship tracking lifecycle", () => {
    it("escalates warmth from cold to warm to hot with repeated interactions", () => {
      const username = "alice";

      // First interaction — account starts as cold
      recordInteraction(username, "our-reply", WORKFLOW_NAME);
      let store = readRelationshipStore(WORKFLOW_NAME);
      let alice = store.accounts.find((a) => a.username === username);
      expect(alice).toBeDefined();
      expect(alice!.warmth).toBe("cold");
      expect(alice!.interactions).toBe(1);

      // Second interaction — still cold (< 3)
      recordInteraction(username, "their-reply", WORKFLOW_NAME);
      store = readRelationshipStore(WORKFLOW_NAME);
      alice = store.accounts.find((a) => a.username === username);
      expect(alice!.warmth).toBe("cold");
      expect(alice!.interactions).toBe(2);

      // Third interaction — transitions to warm (>= 3)
      recordInteraction(username, "our-like", WORKFLOW_NAME);
      store = readRelationshipStore(WORKFLOW_NAME);
      alice = store.accounts.find((a) => a.username === username);
      expect(alice!.warmth).toBe("warm");
      expect(alice!.interactions).toBe(3);

      // Continue to 6 interactions — still warm
      recordInteraction(username, "their-mention", WORKFLOW_NAME);
      recordInteraction(username, "our-reply", WORKFLOW_NAME);
      recordInteraction(username, "their-reply", WORKFLOW_NAME);
      store = readRelationshipStore(WORKFLOW_NAME);
      alice = store.accounts.find((a) => a.username === username);
      expect(alice!.warmth).toBe("warm");
      expect(alice!.interactions).toBe(6);

      // Seventh interaction — transitions to hot (>= 7)
      recordInteraction(username, "our-like", WORKFLOW_NAME);
      store = readRelationshipStore(WORKFLOW_NAME);
      alice = store.accounts.find((a) => a.username === username);
      expect(alice!.warmth).toBe("hot");
      expect(alice!.interactions).toBe(7);

      // Verify reciprocity score was adjusted
      // Mix of our-* (-.1 each) and their-* (+.15 each):
      // our-reply(-.1), their-reply(+.15), our-like(-.1), their-mention(+.15),
      // our-reply(-.1), their-reply(+.15), our-like(-.1)
      // Total = 4*(-0.1) + 3*(0.15) = -0.4 + 0.45 = +0.05 (approximately)
      expect(alice!.reciprocityScore).toBeCloseTo(0.05, 1);
    });
  });

  // --- 4. Working Memory Assembly ---

  describe("Working memory assembly", () => {
    it("builds working memory block containing data from all four stores", () => {
      // Seed actions
      logReply("tweet-100", "user-X", "xander", "Nice insight!", WORKFLOW_NAME);
      logLike("tweet-101", WORKFLOW_NAME);
      logSkip("spammer", "Buy my NFTs!", "spam", WORKFLOW_NAME);

      // Seed facts
      addFact("TypeScript threads get 2x engagement", "strategy", "high", WORKFLOW_NAME);

      // Seed observations
      addObservation(
        {
          date: "2026-02-20",
          sessionId: "session-001",
          content: "AI-related tweets drove the most replies today.",
          priority: 8,
          metrics: { actions: 10, replies: 4, likes: 3, skips: 3 },
        },
        WORKFLOW_NAME,
      );

      // Seed relationships (record enough interactions for warm status)
      recordInteraction("xander", "our-reply", WORKFLOW_NAME);
      recordInteraction("xander", "their-reply", WORKFLOW_NAME);
      recordInteraction("xander", "our-like", WORKFLOW_NAME);

      // Build the working memory block
      const block = getWorkingMemoryBlock(WORKFLOW_NAME);

      // Verify performance section is present (we have actions logged today)
      expect(block).toContain("Performance");
      expect(block).toContain("1 replies"); // 1 reply logged

      // Verify facts section is present
      expect(block).toContain("Known Facts");
      expect(block).toContain("TypeScript threads get 2x engagement");

      // Verify observations section is present
      expect(block).toContain("Session Notes");
      expect(block).toContain("AI-related tweets drove the most replies today");

      // Verify relationships section is present
      expect(block).toContain("Relationships");
      expect(block).toContain("xander");
      expect(block).toContain("warm"); // xander has 3 interactions (warm tier)

      // Verify skip patterns section is present
      expect(block).toContain("Skip Patterns");
      expect(block).toContain("spam");
    });

    it("returns fallback message when no workflow is specified", () => {
      const block = getWorkingMemoryBlock();
      expect(block).toBe("No memory data yet.");
    });
  });

  // --- 5. Migration Lifecycle (memory.json -> actions.json) ---

  describe("Migration lifecycle", () => {
    it("migrates old-format memory.json into actions.json and renames to .backup", () => {
      // Write an old-format memory.json directly into the workflow directory
      const wfDir = join(workspace.workflowsDir, "legacy-wf");
      mkdirSync(wfDir, { recursive: true });

      // Write workflow.json so the workflow is recognized
      const legacyConfig = createMockWorkflowConfig({
        name: "legacy-wf",
        description: "A legacy workflow for migration testing",
      });
      writeWorkflowConfig("legacy-wf", legacyConfig);

      // Write the old memory.json format (no actions.json present)
      const oldMemory = {
        repliedTo: [
          { tweetId: "old-tweet-1", userId: "u1", username: "olduser", date: "2026-02-10T08:00:00Z", ourReply: "Nice!" },
        ],
        liked: ["old-tweet-2", "old-tweet-3"],
        retweeted: [],
        posted: [],
        followed: ["u2"],
        dailyStats: {},
        skipped: [
          { username: "spamguy", snippet: "Buy my stuff", reason: "spam", date: "2026-02-10T09:00:00Z" },
        ],
        blockedAccounts: [],
        feedback: ["Be more conversational"],
      };
      const memoryPath = join(wfDir, "memory.json");
      writeFileSync(memoryPath, JSON.stringify(oldMemory, null, 2) + "\n");

      // Ensure no actions.json exists yet
      const actionsPath = join(wfDir, "actions.json");
      expect(existsSync(actionsPath)).toBe(false);

      // Run migration
      ensureMigrated();

      // Verify actions.json was created
      expect(existsSync(actionsPath)).toBe(true);

      // Verify memory.json was renamed to .backup
      expect(existsSync(memoryPath)).toBe(false);
      expect(existsSync(memoryPath + ".backup")).toBe(true);

      // Verify the migrated action store has the correct data
      const store = readActionStore("legacy-wf");
      expect(store.actions.length).toBeGreaterThanOrEqual(4); // 1 reply + 2 likes + 1 follow + 1 skip

      const replies = store.actions.filter((a) => a.type === "reply");
      expect(replies).toHaveLength(1);
      expect(replies[0].tweetId).toBe("old-tweet-1");
      expect(replies[0].username).toBe("olduser");
      expect(replies[0].text).toBe("Nice!");

      const likes = store.actions.filter((a) => a.type === "like");
      expect(likes).toHaveLength(2);

      const follows = store.actions.filter((a) => a.type === "follow");
      expect(follows).toHaveLength(1);
      expect(follows[0].userId).toBe("u2");

      const skips = store.actions.filter((a) => a.type === "skip");
      expect(skips).toHaveLength(1);
      expect(skips[0].username).toBe("spamguy");
      expect(skips[0].reason).toBe("spam");

      // All migrated actions should be marked as consolidated
      for (const action of store.actions) {
        expect(action.consolidated).toBe(true);
      }

      // Directives should be preserved
      expect(store.directives).toEqual(["Be more conversational"]);

      // Verify empty fact, observation, and relationship stores were initialized
      const factsPath = join(wfDir, "facts.json");
      const observationsPath = join(wfDir, "observations.json");
      const relationshipsPath = join(wfDir, "relationships.json");
      expect(existsSync(factsPath)).toBe(true);
      expect(existsSync(observationsPath)).toBe(true);
      expect(existsSync(relationshipsPath)).toBe(true);
    });
  });
});
