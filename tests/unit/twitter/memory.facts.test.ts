/**
 * Tests for the durable fact store — verifying CRUD operations, batch updates,
 * sorting by confidence/recency, and correct persistence within a named workflow.
 *
 * Facts are atomic pieces of knowledge extracted by the consolidation LLM,
 * stored at `.myteam/workflows/<name>/facts.json`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  readFactStore,
  addFact,
  updateFact,
  deleteFact,
  applyFactUpdates,
  getTopFacts,
} from "@/modules/twitter/memory.facts";
import type { FactUpdate } from "@/modules/twitter/memory.types";

const WF = "test-wf";
let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
  workspace = createTestWorkspace();
  // Create the workflow directory so facts.json can be written there
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- readFactStore ---

describe("readFactStore", () => {
  it("returns empty facts array when no file exists", () => {
    const store = readFactStore(WF);

    expect(store.facts).toEqual([]);
  });

  it("returns parsed facts after manual file write", () => {
    const factsPath = join(workspace.workflowsDir, WF, "facts.json");
    const manual = {
      facts: [
        {
          id: "f_manual",
          content: "Test fact",
          category: "strategy",
          confidence: "high",
          createdAt: "2026-02-20T10:00:00Z",
          updatedAt: "2026-02-20T10:00:00Z",
        },
      ],
    };
    const { writeFileSync } = require("fs");
    writeFileSync(factsPath, JSON.stringify(manual));

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].content).toBe("Test fact");
  });
});

// --- addFact ---

describe("addFact", () => {
  it("creates a fact with generated ID and timestamps", () => {
    const fact = addFact("Replies with questions get 3x engagement", "strategy", "high", WF);

    expect(fact.id).toMatch(/^f_\d+_[a-z0-9]+$/);
    expect(fact.content).toBe("Replies with questions get 3x engagement");
    expect(fact.category).toBe("strategy");
    expect(fact.confidence).toBe("high");
    expect(fact.createdAt).toBe("2026-02-20T12:00:00.000Z");
    expect(fact.updatedAt).toBe("2026-02-20T12:00:00.000Z");
  });

  it("persists to disk and can be read back", () => {
    addFact("Best engagement 9-11am PST", "timing", "medium", WF);
    addFact("@alice likes TypeScript content", "account", "low", WF);

    // Read back from disk to verify persistence
    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(2);
    expect(store.facts[0].content).toBe("Best engagement 9-11am PST");
    expect(store.facts[0].category).toBe("timing");
    expect(store.facts[0].confidence).toBe("medium");
    expect(store.facts[1].content).toBe("@alice likes TypeScript content");
    expect(store.facts[1].category).toBe("account");
    expect(store.facts[1].confidence).toBe("low");
  });

  it("appends to existing facts without overwriting", () => {
    addFact("First fact", "strategy", "high", WF);
    addFact("Second fact", "content", "medium", WF);
    addFact("Third fact", "timing", "low", WF);

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(3);
    expect(store.facts[0].content).toBe("First fact");
    expect(store.facts[1].content).toBe("Second fact");
    expect(store.facts[2].content).toBe("Third fact");
  });
});

// --- updateFact ---

describe("updateFact", () => {
  it("modifies content and updates timestamp", () => {
    const fact = addFact("Original content", "strategy", "high", WF);

    // Advance time so updatedAt changes
    vi.setSystemTime(new Date("2026-02-20T14:00:00Z"));

    const result = updateFact(fact.id, { content: "Updated content" }, WF);

    expect(result).toBe(true);
    const store = readFactStore(WF);
    const updated = store.facts.find((f) => f.id === fact.id);
    expect(updated?.content).toBe("Updated content");
    expect(updated?.updatedAt).toBe("2026-02-20T14:00:00.000Z");
    // createdAt should remain unchanged
    expect(updated?.createdAt).toBe("2026-02-20T12:00:00.000Z");
  });

  it("modifies category", () => {
    const fact = addFact("Some knowledge", "strategy", "high", WF);

    const result = updateFact(fact.id, { category: "timing" }, WF);

    expect(result).toBe(true);
    const store = readFactStore(WF);
    expect(store.facts[0].category).toBe("timing");
  });

  it("modifies confidence", () => {
    const fact = addFact("Uncertain insight", "content", "low", WF);

    const result = updateFact(fact.id, { confidence: "high" }, WF);

    expect(result).toBe(true);
    const store = readFactStore(WF);
    expect(store.facts[0].confidence).toBe("high");
  });

  it("modifies multiple fields at once", () => {
    const fact = addFact("Old text", "strategy", "low", WF);

    vi.setSystemTime(new Date("2026-02-20T15:00:00Z"));
    const result = updateFact(
      fact.id,
      { content: "New text", category: "audience", confidence: "high" },
      WF,
    );

    expect(result).toBe(true);
    const store = readFactStore(WF);
    const updated = store.facts[0];
    expect(updated.content).toBe("New text");
    expect(updated.category).toBe("audience");
    expect(updated.confidence).toBe("high");
    expect(updated.updatedAt).toBe("2026-02-20T15:00:00.000Z");
  });

  it("returns false for non-existent ID", () => {
    addFact("Some fact", "strategy", "high", WF);

    const result = updateFact("f_nonexistent_abc123", { content: "Nope" }, WF);

    expect(result).toBe(false);

    // Existing facts should be untouched
    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].content).toBe("Some fact");
  });
});

// --- deleteFact ---

describe("deleteFact", () => {
  it("removes a fact by ID", () => {
    const fact1 = addFact("Keep this", "strategy", "high", WF);
    const fact2 = addFact("Delete this", "content", "low", WF);

    const result = deleteFact(fact2.id, WF);

    expect(result).toBe(true);
    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].id).toBe(fact1.id);
    expect(store.facts[0].content).toBe("Keep this");
  });

  it("returns false for non-existent ID", () => {
    addFact("Existing fact", "strategy", "high", WF);

    const result = deleteFact("f_nonexistent_xyz789", WF);

    expect(result).toBe(false);

    // Store should be unchanged
    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(1);
  });

  it("handles deleting the only fact, leaving empty store", () => {
    const fact = addFact("Only fact", "timing", "medium", WF);

    const result = deleteFact(fact.id, WF);

    expect(result).toBe(true);
    const store = readFactStore(WF);
    expect(store.facts).toEqual([]);
  });
});

// --- applyFactUpdates ---

describe("applyFactUpdates", () => {
  it("handles ADD operations", () => {
    const updates: FactUpdate[] = [
      { operation: "ADD", content: "New insight", category: "strategy", confidence: "high" },
      { operation: "ADD", content: "Another insight", category: "timing", confidence: "low" },
    ];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(2);
    expect(store.facts[0].content).toBe("New insight");
    expect(store.facts[0].category).toBe("strategy");
    expect(store.facts[0].confidence).toBe("high");
    expect(store.facts[1].content).toBe("Another insight");
    expect(store.facts[1].category).toBe("timing");
    expect(store.facts[1].confidence).toBe("low");
  });

  it("defaults confidence to medium when not specified in ADD", () => {
    const updates: FactUpdate[] = [
      { operation: "ADD", content: "No confidence given", category: "content" },
    ];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts[0].confidence).toBe("medium");
  });

  it("handles UPDATE operations", () => {
    const fact = addFact("Original", "strategy", "low", WF);

    vi.setSystemTime(new Date("2026-02-20T14:00:00Z"));
    const updates: FactUpdate[] = [
      { operation: "UPDATE", id: fact.id, content: "Revised", confidence: "high" },
    ];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts[0].content).toBe("Revised");
    expect(store.facts[0].confidence).toBe("high");
  });

  it("handles DELETE operations", () => {
    const fact1 = addFact("Keep", "strategy", "high", WF);
    const fact2 = addFact("Remove", "content", "low", WF);

    const updates: FactUpdate[] = [{ operation: "DELETE", id: fact2.id }];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].id).toBe(fact1.id);
  });

  it("handles mixed ADD, UPDATE, DELETE in a single batch", () => {
    const existing = addFact("Will be updated", "strategy", "low", WF);
    const toDelete = addFact("Will be deleted", "content", "medium", WF);

    vi.setSystemTime(new Date("2026-02-20T16:00:00Z"));
    const updates: FactUpdate[] = [
      { operation: "UPDATE", id: existing.id, content: "Updated text", confidence: "high" },
      { operation: "DELETE", id: toDelete.id },
      { operation: "ADD", content: "Brand new fact", category: "audience", confidence: "medium" },
    ];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(2);

    // First fact should be the updated one
    expect(store.facts[0].content).toBe("Updated text");
    expect(store.facts[0].confidence).toBe("high");

    // Second fact should be the newly added one
    expect(store.facts[1].content).toBe("Brand new fact");
    expect(store.facts[1].category).toBe("audience");
  });

  it("skips ADD when content or category is missing", () => {
    const updates: FactUpdate[] = [
      { operation: "ADD", content: "No category" } as FactUpdate,
      { operation: "ADD", category: "strategy" } as FactUpdate,
    ];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(0);
  });

  it("skips UPDATE and DELETE when id is missing", () => {
    const fact = addFact("Should survive", "strategy", "high", WF);

    const updates: FactUpdate[] = [
      { operation: "UPDATE", content: "No id" } as FactUpdate,
      { operation: "DELETE" } as FactUpdate,
    ];

    applyFactUpdates(updates, WF);

    const store = readFactStore(WF);
    expect(store.facts).toHaveLength(1);
    expect(store.facts[0].content).toBe("Should survive");
  });
});

// --- getTopFacts ---

describe("getTopFacts", () => {
  it("returns empty array when no facts exist", () => {
    const top = getTopFacts(10, WF);
    expect(top).toEqual([]);
  });

  it("sorts by confidence — high first, then medium, then low", () => {
    addFact("Low confidence", "strategy", "low", WF);
    addFact("High confidence", "strategy", "high", WF);
    addFact("Medium confidence", "strategy", "medium", WF);

    const top = getTopFacts(10, WF);

    expect(top).toHaveLength(3);
    expect(top[0].confidence).toBe("high");
    expect(top[0].content).toBe("High confidence");
    expect(top[1].confidence).toBe("medium");
    expect(top[1].content).toBe("Medium confidence");
    expect(top[2].confidence).toBe("low");
    expect(top[2].content).toBe("Low confidence");
  });

  it("sorts by recency within same confidence tier — newer first", () => {
    // Add three facts with same confidence but at different times
    vi.setSystemTime(new Date("2026-02-20T10:00:00Z"));
    addFact("Oldest", "strategy", "high", WF);

    vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
    addFact("Middle", "strategy", "high", WF);

    vi.setSystemTime(new Date("2026-02-20T14:00:00Z"));
    addFact("Newest", "strategy", "high", WF);

    const top = getTopFacts(10, WF);

    expect(top).toHaveLength(3);
    expect(top[0].content).toBe("Newest");
    expect(top[1].content).toBe("Middle");
    expect(top[2].content).toBe("Oldest");
  });

  it("combines confidence and recency sorting correctly", () => {
    // High-confidence old fact should still beat medium-confidence recent fact
    vi.setSystemTime(new Date("2026-02-20T08:00:00Z"));
    addFact("High old", "strategy", "high", WF);

    vi.setSystemTime(new Date("2026-02-20T16:00:00Z"));
    addFact("Medium recent", "strategy", "medium", WF);

    vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
    addFact("Low middle", "strategy", "low", WF);

    const top = getTopFacts(10, WF);

    expect(top[0].content).toBe("High old");
    expect(top[1].content).toBe("Medium recent");
    expect(top[2].content).toBe("Low middle");
  });

  it("limits results to N", () => {
    addFact("Fact 1", "strategy", "high", WF);
    addFact("Fact 2", "content", "high", WF);
    addFact("Fact 3", "timing", "high", WF);
    addFact("Fact 4", "audience", "medium", WF);
    addFact("Fact 5", "account", "low", WF);

    const top2 = getTopFacts(2, WF);
    expect(top2).toHaveLength(2);

    const top4 = getTopFacts(4, WF);
    expect(top4).toHaveLength(4);
  });

  it("returns all facts when N exceeds total count", () => {
    addFact("Only fact", "strategy", "high", WF);

    const top = getTopFacts(100, WF);
    expect(top).toHaveLength(1);
    expect(top[0].content).toBe("Only fact");
  });

  it("does not mutate the underlying store order", () => {
    addFact("Low", "strategy", "low", WF);
    addFact("High", "strategy", "high", WF);

    // getTopFacts should sort but not change the persisted order
    getTopFacts(10, WF);

    const store = readFactStore(WF);
    expect(store.facts[0].content).toBe("Low");
    expect(store.facts[1].content).toBe("High");
  });
});
