/**
 * Tests for per-account relationship tracking (CRM layer) — verifying
 * store persistence, username normalization, interaction recording,
 * warmth auto-escalation, reciprocity scoring, sorting queries,
 * and bulk updates from the consolidation pipeline.
 *
 * Uses fake timers to control timestamps and an isolated temp workspace
 * to avoid polluting the real filesystem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  readRelationshipStore,
  getOrCreateRelationship,
  recordInteraction,
  getTopRelationships,
  applyRelationshipUpdates,
} from "@/modules/twitter/memory.relationships";

const WF = "test-wf";
let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
  workspace = createTestWorkspace();
  // Create the workflow directory so relationships.json can be written there
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- readRelationshipStore ---

describe("readRelationshipStore", () => {
  it("returns empty accounts array when no file exists", () => {
    const store = readRelationshipStore(WF);

    expect(store.accounts).toEqual([]);
  });
});

// --- getOrCreateRelationship ---

describe("getOrCreateRelationship", () => {
  it("creates a new account with default values for unknown username", () => {
    const account = getOrCreateRelationship("alice", WF);

    expect(account.username).toBe("alice");
    expect(account.followStatus).toBe("none");
    expect(account.warmth).toBe("cold");
    expect(account.interactions).toBe(0);
    expect(account.topics).toEqual([]);
    expect(account.notes).toBe("");
    expect(account.reciprocityScore).toBe(0);
    expect(account.firstSeen).toBe("2026-02-20T12:00:00.000Z");
    expect(account.lastInteraction).toBe("2026-02-20T12:00:00.000Z");
  });

  it("persists the new account to disk", () => {
    getOrCreateRelationship("alice", WF);

    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
    expect(store.accounts[0].username).toBe("alice");
  });

  it("returns existing account for known username", () => {
    // Create the account first
    getOrCreateRelationship("alice", WF);

    // Advance time so we can verify it returns the original, not a new one
    vi.setSystemTime(new Date("2026-02-21T12:00:00Z"));
    const account = getOrCreateRelationship("alice", WF);

    // Should still have the original firstSeen timestamp
    expect(account.firstSeen).toBe("2026-02-20T12:00:00.000Z");

    // Should not duplicate accounts
    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
  });

  it("normalizes username to lowercase", () => {
    getOrCreateRelationship("Alice", WF);
    const account = getOrCreateRelationship("ALICE", WF);

    expect(account.username).toBe("alice");

    // Should be a single account, not two
    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
  });

  it("strips leading @ from username", () => {
    getOrCreateRelationship("@Bob", WF);
    const account = getOrCreateRelationship("bob", WF);

    expect(account.username).toBe("bob");

    // Should be a single account, not two
    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
  });

  it("normalizes both @ prefix and case together", () => {
    getOrCreateRelationship("@CamelCase", WF);
    const account = getOrCreateRelationship("camelcase", WF);

    expect(account.username).toBe("camelcase");

    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
  });
});

// --- recordInteraction ---

describe("recordInteraction", () => {
  it("increments interaction count", () => {
    recordInteraction("alice", "our-reply", WF);
    recordInteraction("alice", "our-like", WF);

    const store = readRelationshipStore(WF);
    const alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.interactions).toBe(2);
  });

  it("creates account on first interaction if it does not exist", () => {
    recordInteraction("newuser", "our-reply", WF);

    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
    expect(store.accounts[0].username).toBe("newuser");
    expect(store.accounts[0].interactions).toBe(1);
  });

  it("updates lastInteraction timestamp", () => {
    recordInteraction("alice", "our-reply", WF);

    // Advance time
    vi.setSystemTime(new Date("2026-02-22T18:30:00Z"));
    recordInteraction("alice", "our-like", WF);

    const store = readRelationshipStore(WF);
    const alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.lastInteraction).toBe("2026-02-22T18:30:00.000Z");
  });

  // --- Warmth Auto-Escalation ---

  describe("warmth auto-escalation", () => {
    it("stays cold at 0-2 interactions", () => {
      recordInteraction("alice", "our-reply", WF);
      recordInteraction("alice", "our-like", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.interactions).toBe(2);
      expect(alice?.warmth).toBe("cold");
    });

    it("escalates to warm at 3 interactions", () => {
      recordInteraction("alice", "our-reply", WF);
      recordInteraction("alice", "our-like", WF);
      recordInteraction("alice", "their-reply", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.interactions).toBe(3);
      expect(alice?.warmth).toBe("warm");
    });

    it("stays warm at 6 interactions", () => {
      for (let i = 0; i < 6; i++) {
        recordInteraction("alice", "our-reply", WF);
      }

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.interactions).toBe(6);
      expect(alice?.warmth).toBe("warm");
    });

    it("escalates to hot at 7 interactions", () => {
      for (let i = 0; i < 7; i++) {
        recordInteraction("alice", "our-reply", WF);
      }

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.interactions).toBe(7);
      expect(alice?.warmth).toBe("hot");
    });

    it("remains hot beyond 7 interactions", () => {
      for (let i = 0; i < 10; i++) {
        recordInteraction("alice", "our-reply", WF);
      }

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.interactions).toBe(10);
      expect(alice?.warmth).toBe("hot");
    });
  });

  // --- Follow Status ---

  describe("follow status updates", () => {
    it("our-follow sets followStatus to we-follow", () => {
      recordInteraction("alice", "our-follow", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.followStatus).toBe("we-follow");
    });

    it("our-follow upgrades they-follow to mutual", () => {
      // Seed the account with they-follow status by writing directly to disk
      getOrCreateRelationship("alice", WF);
      const store = readRelationshipStore(WF);
      store.accounts[0].followStatus = "they-follow";
      const relPath = join(workspace.workflowsDir, WF, "relationships.json");
      writeFileSync(relPath, JSON.stringify(store, null, 2) + "\n");

      recordInteraction("alice", "our-follow", WF);

      const updated = readRelationshipStore(WF);
      const alice = updated.accounts.find((a) => a.username === "alice");
      expect(alice?.followStatus).toBe("mutual");
    });

    it("non-follow interactions do not change followStatus", () => {
      recordInteraction("alice", "our-reply", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.followStatus).toBe("none");
    });
  });

  // --- Reciprocity Score ---

  describe("reciprocity score", () => {
    it("nudges negative for our interactions", () => {
      recordInteraction("alice", "our-reply", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      // our-reply nudges by -0.1
      expect(alice?.reciprocityScore).toBeCloseTo(-0.1, 5);
    });

    it("nudges positive for their interactions", () => {
      recordInteraction("alice", "their-reply", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      // their-reply nudges by +0.15
      expect(alice?.reciprocityScore).toBeCloseTo(0.15, 5);
    });

    it("accumulates across multiple interactions", () => {
      // 2 of ours: -0.1 * 2 = -0.2
      recordInteraction("alice", "our-reply", WF);
      recordInteraction("alice", "our-like", WF);
      // 1 of theirs: +0.15
      recordInteraction("alice", "their-mention", WF);

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      // -0.2 + 0.15 = -0.05
      expect(alice?.reciprocityScore).toBeCloseTo(-0.05, 5);
    });

    it("clamps to max of 1", () => {
      // 10 their-replies: 10 * 0.15 = 1.5, but clamped to 1
      for (let i = 0; i < 10; i++) {
        recordInteraction("alice", "their-reply", WF);
      }

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.reciprocityScore).toBeLessThanOrEqual(1);
      expect(alice?.reciprocityScore).toBe(1);
    });

    it("clamps to min of -1", () => {
      // 15 our-replies: 15 * -0.1 = -1.5, but clamped to -1
      for (let i = 0; i < 15; i++) {
        recordInteraction("alice", "our-reply", WF);
      }

      const store = readRelationshipStore(WF);
      const alice = store.accounts.find((a) => a.username === "alice");
      expect(alice?.reciprocityScore).toBeGreaterThanOrEqual(-1);
      expect(alice?.reciprocityScore).toBe(-1);
    });
  });
});

// --- getTopRelationships ---

describe("getTopRelationships", () => {
  /** Helper: record N interactions to push an account to a target warmth tier */
  function warmUp(username: string, count: number): void {
    for (let i = 0; i < count; i++) {
      recordInteraction(username, "our-reply", WF);
    }
  }

  it("returns empty array when no accounts exist", () => {
    const top = getTopRelationships(5, WF);
    expect(top).toEqual([]);
  });

  it("sorts by warmth tier — hot first, then warm, then cold", () => {
    // Create accounts with different warmth levels
    warmUp("cold-user", 1);    // 1 interaction = cold
    warmUp("warm-user", 4);    // 4 interactions = warm
    warmUp("hot-user", 8);     // 8 interactions = hot

    const top = getTopRelationships(10, WF);

    expect(top[0].username).toBe("hot-user");
    expect(top[0].warmth).toBe("hot");
    expect(top[1].username).toBe("warm-user");
    expect(top[1].warmth).toBe("warm");
    expect(top[2].username).toBe("cold-user");
    expect(top[2].warmth).toBe("cold");
  });

  it("within same warmth tier, sorts by recency (most recent first)", () => {
    // Create two cold accounts at different times
    vi.setSystemTime(new Date("2026-02-18T10:00:00Z"));
    recordInteraction("older-user", "our-reply", WF);

    vi.setSystemTime(new Date("2026-02-20T10:00:00Z"));
    recordInteraction("newer-user", "our-reply", WF);

    const top = getTopRelationships(10, WF);

    // Both are cold (1 interaction each), so newer should come first
    expect(top[0].username).toBe("newer-user");
    expect(top[1].username).toBe("older-user");
  });

  it("limits results to N entries", () => {
    warmUp("user-a", 1);
    warmUp("user-b", 1);
    warmUp("user-c", 1);
    warmUp("user-d", 1);
    warmUp("user-e", 1);

    const top = getTopRelationships(3, WF);

    expect(top).toHaveLength(3);
  });

  it("returns all accounts when N exceeds total count", () => {
    warmUp("user-a", 1);
    warmUp("user-b", 1);

    const top = getTopRelationships(100, WF);

    expect(top).toHaveLength(2);
  });
});

// --- applyRelationshipUpdates ---

describe("applyRelationshipUpdates", () => {
  it("creates accounts that do not exist yet", () => {
    applyRelationshipUpdates(
      [{ username: "new-account", notes: "Discovered from search" }],
      WF,
    );

    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
    expect(store.accounts[0].username).toBe("new-account");
    expect(store.accounts[0].warmth).toBe("cold");
    expect(store.accounts[0].interactions).toBe(0);
  });

  it("normalizes username when creating new accounts", () => {
    applyRelationshipUpdates(
      [{ username: "@NewAccount" }],
      WF,
    );

    const store = readRelationshipStore(WF);
    expect(store.accounts[0].username).toBe("newaccount");
  });

  it("applies warmthChange by adjusting interaction count", () => {
    // Seed an account with some interactions
    for (let i = 0; i < 2; i++) {
      recordInteraction("alice", "our-reply", WF);
    }

    // Verify starting state: 2 interactions = cold
    let store = readRelationshipStore(WF);
    let alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.interactions).toBe(2);
    expect(alice?.warmth).toBe("cold");

    // Apply a warmth boost of +2 (2 + 2 = 4 interactions = warm)
    applyRelationshipUpdates(
      [{ username: "alice", warmthChange: 2 }],
      WF,
    );

    store = readRelationshipStore(WF);
    alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.interactions).toBe(4);
    expect(alice?.warmth).toBe("warm");
  });

  it("negative warmthChange reduces interaction count but not below zero", () => {
    recordInteraction("alice", "our-reply", WF);

    applyRelationshipUpdates(
      [{ username: "alice", warmthChange: -10 }],
      WF,
    );

    const store = readRelationshipStore(WF);
    const alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.interactions).toBe(0);
    expect(alice?.warmth).toBe("cold");
  });

  it("skips warmthChange when it is zero", () => {
    for (let i = 0; i < 4; i++) {
      recordInteraction("alice", "our-reply", WF);
    }

    applyRelationshipUpdates(
      [{ username: "alice", warmthChange: 0 }],
      WF,
    );

    const store = readRelationshipStore(WF);
    const alice = store.accounts.find((a) => a.username === "alice");
    // Should remain unchanged: 4 interactions = warm
    expect(alice?.interactions).toBe(4);
    expect(alice?.warmth).toBe("warm");
  });

  it("adds new topics without duplicates", () => {
    getOrCreateRelationship("alice", WF);

    // First update: add some topics
    applyRelationshipUpdates(
      [{ username: "alice", topicsToAdd: ["typescript", "testing"] }],
      WF,
    );

    let store = readRelationshipStore(WF);
    let alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.topics).toEqual(["typescript", "testing"]);

    // Second update: add overlapping + new topics
    applyRelationshipUpdates(
      [{ username: "alice", topicsToAdd: ["testing", "vitest", "typescript"] }],
      WF,
    );

    store = readRelationshipStore(WF);
    alice = store.accounts.find((a) => a.username === "alice");
    // "testing" and "typescript" should not be duplicated
    expect(alice?.topics).toEqual(["typescript", "testing", "vitest"]);
  });

  it("appends notes with timestamp prefix", () => {
    getOrCreateRelationship("alice", WF);

    applyRelationshipUpdates(
      [{ username: "alice", notes: "Engages with TypeScript content" }],
      WF,
    );

    const store = readRelationshipStore(WF);
    const alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.notes).toBe("[2026-02-20] Engages with TypeScript content");
  });

  it("concatenates multiple notes with pipe separator", () => {
    getOrCreateRelationship("alice", WF);

    applyRelationshipUpdates(
      [{ username: "alice", notes: "First note" }],
      WF,
    );

    vi.setSystemTime(new Date("2026-02-21T12:00:00Z"));
    applyRelationshipUpdates(
      [{ username: "alice", notes: "Second note" }],
      WF,
    );

    const store = readRelationshipStore(WF);
    const alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.notes).toBe("[2026-02-20] First note | [2026-02-21] Second note");
  });

  it("handles multiple updates in a single batch", () => {
    getOrCreateRelationship("alice", WF);
    getOrCreateRelationship("bob", WF);

    applyRelationshipUpdates(
      [
        { username: "alice", topicsToAdd: ["rust"], notes: "Rust enthusiast" },
        { username: "bob", warmthChange: 5, topicsToAdd: ["go"] },
        { username: "charlie", notes: "New discovery" },
      ],
      WF,
    );

    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(3);

    const alice = store.accounts.find((a) => a.username === "alice");
    expect(alice?.topics).toEqual(["rust"]);
    expect(alice?.notes).toContain("Rust enthusiast");

    const bob = store.accounts.find((a) => a.username === "bob");
    expect(bob?.interactions).toBe(5);
    expect(bob?.warmth).toBe("warm");
    expect(bob?.topics).toEqual(["go"]);

    // charlie was created fresh by the update
    const charlie = store.accounts.find((a) => a.username === "charlie");
    expect(charlie).toBeDefined();
    expect(charlie?.notes).toContain("New discovery");
  });

  it("handles empty updates array gracefully", () => {
    getOrCreateRelationship("alice", WF);

    applyRelationshipUpdates([], WF);

    const store = readRelationshipStore(WF);
    expect(store.accounts).toHaveLength(1);
  });
});
