/**
 * Tests for memory.consolidate.ts — the daily LLM-powered extraction pipeline.
 *
 * Covers the three exported functions:
 *   - needsConsolidation: time + data eligibility checks
 *   - runConsolidation: full pipeline (actions → Claude → facts/observations/relationships)
 *   - runManualConsolidation: CLI entry point (skips 24h interval check)
 *
 * Mocks the Anthropic client (via auth module) so no real API calls are made.
 * Uses fake timers to control time-dependent logic (24h interval, 12h action age).
 * Uses createTestWorkspace for isolated filesystem tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import { createMockWorkflowConfig } from "../../helpers/mock-data";

// --- Module Mocks ---

// Mock the auth module to return a controllable Anthropic client
vi.mock("@/modules/auth", () => ({
  createAnthropicClient: vi.fn(),
}));

// Mock common module to suppress console output and provide test env values
vi.mock("@/common", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/common")>();
  return {
    ...original,
    readEnv: vi.fn(() => ({ ANTHROPIC_API_KEY: "test-key" })),
    spinner: vi.fn(() => ({ stop: vi.fn() })),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  };
});

// Mock workflow.migrate to prevent auto-migration side effects
vi.mock("@/modules/twitter/workflow.migrate", () => ({
  ensureMigrated: vi.fn(),
}));

// --- Imports (after mocks) ---

import { createAnthropicClient } from "@/modules/auth";
import { saveActionStore } from "@/modules/twitter/memory.actions";
import { readFactStore } from "@/modules/twitter/memory.facts";
import { readObservationStore } from "@/modules/twitter/memory.observations";
import { readRelationshipStore } from "@/modules/twitter/memory.relationships";
import { writeWorkflowConfig } from "@/modules/twitter/workflow";
import {
  needsConsolidation,
  runConsolidation,
  runManualConsolidation,
} from "@/modules/twitter/memory.consolidate";
import type { ActionStore, Action } from "@/modules/twitter/memory.types";

// --- Constants ---

const WF = "test-consolidate";

/** The fixed "now" used across all tests: 2026-02-20 at noon UTC */
const NOW = new Date("2026-02-20T12:00:00Z");

// --- Helpers ---

/** Create a single action with sensible defaults, overridable per-field */
function createAction(overrides?: Partial<Action>): Action {
  return {
    type: "reply",
    tweetId: `tweet-${Math.random().toString(36).slice(2, 8)}`,
    username: "alice",
    text: "Great point about TypeScript!",
    date: new Date("2026-02-19T10:00:00Z").toISOString(), // >24h ago by default
    consolidated: false,
    ...overrides,
  };
}

/** Create an action store with pre-built actions */
function createActionStore(overrides?: Partial<ActionStore>): ActionStore {
  return {
    actions: [],
    directives: [],
    lastConsolidation: null,
    ...overrides,
  };
}

/** Build a mock Claude response with the standard ConsolidationResult shape */
function mockClaudeResponse(result: {
  observations?: Array<{ content: string; priority: number; metrics?: { actions: number; replies: number; likes: number; skips: number } }>;
  factUpdates?: Array<{ operation: string; content?: string; category?: string; confidence?: string; id?: string }>;
  relationshipUpdates?: Array<{ username: string; topicsToAdd?: string[]; notes?: string; warmthChange?: number }>;
}) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        observations: result.observations ?? [],
        factUpdates: result.factUpdates ?? [],
        relationshipUpdates: result.relationshipUpdates ?? [],
      }),
    }],
  };
}

/** Set up the mock Anthropic client to return a given response */
function setupMockClient(response: ReturnType<typeof mockClaudeResponse>) {
  const mockCreate = vi.fn().mockResolvedValue(response);
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { create: mockCreate },
  } as any);
  return mockCreate;
}

// --- Test Setup ---

let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  workspace = createTestWorkspace();

  // Create the workflow directory and seed a valid workflow config
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
  writeWorkflowConfig(WF, createMockWorkflowConfig({ name: WF }));
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- needsConsolidation ---

describe("needsConsolidation", () => {
  it("returns false when lastConsolidation is recent (< 24h ago)", () => {
    // Last consolidation was 6 hours ago — too soon to run again
    const sixHoursAgo = new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const store = createActionStore({
      lastConsolidation: sixHoursAgo,
      actions: [createAction({ date: new Date("2026-02-19T05:00:00Z").toISOString() })],
    });
    saveActionStore(store, WF);

    expect(needsConsolidation(WF)).toBe(false);
  });

  it("returns false when no unconsolidated actions exist", () => {
    // No lastConsolidation but all actions are already consolidated
    const store = createActionStore({
      actions: [
        createAction({ consolidated: true, date: new Date("2026-02-19T05:00:00Z").toISOString() }),
        createAction({ consolidated: true, date: new Date("2026-02-19T06:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    expect(needsConsolidation(WF)).toBe(false);
  });

  it("returns false when unconsolidated actions are too recent (< 12h old)", () => {
    // Actions from 3 hours ago — not old enough (must be >12h)
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const store = createActionStore({
      lastConsolidation: null,
      actions: [createAction({ date: threeHoursAgo })],
    });
    saveActionStore(store, WF);

    expect(needsConsolidation(WF)).toBe(false);
  });

  it("returns true when lastConsolidation is null and actions exist >12h old", () => {
    // First ever run — no lastConsolidation, actions are 24+ hours old
    const store = createActionStore({
      actions: [
        createAction({ date: new Date("2026-02-19T05:00:00Z").toISOString() }),
        createAction({ date: new Date("2026-02-19T06:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    expect(needsConsolidation(WF)).toBe(true);
  });

  it("returns true when lastConsolidation > 24h ago and actions exist >12h old", () => {
    // Last ran 30 hours ago, and there are old enough unconsolidated actions
    const thirtyHoursAgo = new Date(NOW.getTime() - 30 * 60 * 60 * 1000).toISOString();
    const store = createActionStore({
      lastConsolidation: thirtyHoursAgo,
      actions: [
        createAction({ date: new Date("2026-02-19T08:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    expect(needsConsolidation(WF)).toBe(true);
  });

  it("returns false when action store is empty", () => {
    // No actions at all — nothing to consolidate
    const store = createActionStore({ actions: [] });
    saveActionStore(store, WF);

    expect(needsConsolidation(WF)).toBe(false);
  });
});

// --- runConsolidation ---

describe("runConsolidation", () => {
  it("calls Claude and applies fact updates", async () => {
    // Seed actions older than 12h
    const store = createActionStore({
      actions: [
        createAction({
          type: "reply",
          username: "alice",
          text: "Great TypeScript tip!",
          date: new Date("2026-02-19T08:00:00Z").toISOString(),
        }),
        createAction({
          type: "like",
          username: "bob",
          date: new Date("2026-02-19T08:05:00Z").toISOString(),
        }),
      ],
    });
    saveActionStore(store, WF);

    // Mock Claude to return fact updates
    const mockCreate = setupMockClient(mockClaudeResponse({
      observations: [
        { content: "Good engagement with TypeScript content", priority: 7 },
      ],
      factUpdates: [
        { operation: "ADD", content: "TypeScript content gets high engagement", category: "strategy", confidence: "medium" },
        { operation: "ADD", content: "Morning posts perform better", category: "timing", confidence: "low" },
      ],
      relationshipUpdates: [
        { username: "alice", topicsToAdd: ["typescript"], notes: "Active contributor" },
      ],
    }));

    const workflow = createMockWorkflowConfig({ name: WF });
    await runConsolidation(WF, workflow);

    // Verify Claude was called
    expect(mockCreate).toHaveBeenCalledOnce();

    // Verify facts were applied
    const facts = readFactStore(WF);
    expect(facts.facts).toHaveLength(2);
    expect(facts.facts[0].content).toBe("TypeScript content gets high engagement");
    expect(facts.facts[0].category).toBe("strategy");
    expect(facts.facts[1].content).toBe("Morning posts perform better");
    expect(facts.facts[1].category).toBe("timing");
  });

  it("applies observation updates from Claude response", async () => {
    const store = createActionStore({
      actions: [
        createAction({ date: new Date("2026-02-19T09:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    setupMockClient(mockClaudeResponse({
      observations: [
        { content: "Session focused on AI discussions", priority: 8, metrics: { actions: 5, replies: 3, likes: 2, skips: 0 } },
        { content: "High engagement rate observed", priority: 6 },
      ],
    }));

    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    const obs = readObservationStore(WF);
    expect(obs.observations).toHaveLength(2);
    expect(obs.observations[0].content).toBe("Session focused on AI discussions");
    expect(obs.observations[0].priority).toBe(8);
    expect(obs.observations[0].metrics).toEqual({ actions: 5, replies: 3, likes: 2, skips: 0 });
    expect(obs.observations[1].content).toBe("High engagement rate observed");
    expect(obs.observations[1].priority).toBe(6);
  });

  it("applies relationship updates from Claude response", async () => {
    const store = createActionStore({
      actions: [
        createAction({
          username: "carol",
          date: new Date("2026-02-19T07:00:00Z").toISOString(),
        }),
      ],
    });
    saveActionStore(store, WF);

    setupMockClient(mockClaudeResponse({
      relationshipUpdates: [
        { username: "carol", topicsToAdd: ["rust", "wasm"], notes: "Interested in systems programming" },
        { username: "dave", topicsToAdd: ["react"], notes: "Frontend enthusiast", warmthChange: 2 },
      ],
    }));

    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    const rels = readRelationshipStore(WF);
    expect(rels.accounts).toHaveLength(2);

    const carol = rels.accounts.find((a) => a.username === "carol");
    expect(carol).toBeDefined();
    expect(carol!.topics).toContain("rust");
    expect(carol!.topics).toContain("wasm");
    expect(carol!.notes).toContain("Interested in systems programming");

    const dave = rels.accounts.find((a) => a.username === "dave");
    expect(dave).toBeDefined();
    expect(dave!.topics).toContain("react");
    expect(dave!.interactions).toBe(2); // warmthChange applied
  });

  it("marks actions as consolidated after processing", async () => {
    const store = createActionStore({
      actions: [
        createAction({
          tweetId: "t1",
          date: new Date("2026-02-19T06:00:00Z").toISOString(),
        }),
        createAction({
          tweetId: "t2",
          date: new Date("2026-02-19T07:00:00Z").toISOString(),
        }),
      ],
    });
    saveActionStore(store, WF);

    setupMockClient(mockClaudeResponse({
      observations: [{ content: "Test observation", priority: 5 }],
    }));

    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    // Re-read the action store to verify consolidation markers
    const { readActionStore } = await import("@/modules/twitter/memory.actions");
    const updated = readActionStore(WF);
    expect(updated.actions[0].consolidated).toBe(true);
    expect(updated.actions[1].consolidated).toBe(true);
  });

  it("updates lastConsolidation timestamp after processing", async () => {
    const store = createActionStore({
      actions: [
        createAction({ date: new Date("2026-02-19T06:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    setupMockClient(mockClaudeResponse({
      observations: [{ content: "Test", priority: 5 }],
    }));

    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    const { readActionStore } = await import("@/modules/twitter/memory.actions");
    const updated = readActionStore(WF);
    expect(updated.lastConsolidation).not.toBeNull();
    // Should be set to the faked "now" time
    expect(updated.lastConsolidation).toBe(NOW.toISOString());
  });

  it("does nothing when there are no unconsolidated actions old enough", async () => {
    // Actions only 3 hours old — under the 12h threshold
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const store = createActionStore({
      actions: [createAction({ date: threeHoursAgo })],
    });
    saveActionStore(store, WF);

    const mockCreate = setupMockClient(mockClaudeResponse({}));

    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    // Claude should NOT have been called since no eligible actions exist
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("groups actions into separate sessions based on 30-min gaps", async () => {
    // Two clusters of actions separated by >30 minutes
    const store = createActionStore({
      actions: [
        // Session 1: 9:00 and 9:10
        createAction({ tweetId: "t1", date: new Date("2026-02-19T09:00:00Z").toISOString() }),
        createAction({ tweetId: "t2", date: new Date("2026-02-19T09:10:00Z").toISOString() }),
        // Session 2: 11:00 (>30min gap from 9:10)
        createAction({ tweetId: "t3", date: new Date("2026-02-19T11:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    const mockCreate = setupMockClient(mockClaudeResponse({
      observations: [{ content: "Multi-session analysis", priority: 5 }],
    }));

    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    // Verify the prompt sent to Claude mentions both sessions
    expect(mockCreate).toHaveBeenCalledOnce();
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Session 1");
    expect(prompt).toContain("Session 2");
  });

  it("loads workflow config from disk when not provided", async () => {
    const store = createActionStore({
      actions: [
        createAction({ date: new Date("2026-02-19T06:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    const mockCreate = setupMockClient(mockClaudeResponse({
      observations: [{ content: "Loaded from disk", priority: 5 }],
    }));

    // Call without passing workflow — should read from disk
    await runConsolidation(WF);

    expect(mockCreate).toHaveBeenCalledOnce();
    // The prompt should contain the workflow name from the seeded config
    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain(WF);
  });

  it("handles empty observations/facts/relationships gracefully", async () => {
    const store = createActionStore({
      actions: [
        createAction({ date: new Date("2026-02-19T06:00:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    // Claude returns empty arrays for all update types
    setupMockClient(mockClaudeResponse({
      observations: [],
      factUpdates: [],
      relationshipUpdates: [],
    }));

    // Should not throw
    await runConsolidation(WF, createMockWorkflowConfig({ name: WF }));

    // Stores should remain empty
    expect(readFactStore(WF).facts).toHaveLength(0);
    expect(readObservationStore(WF).observations).toHaveLength(0);
    expect(readRelationshipStore(WF).accounts).toHaveLength(0);
  });
});

// --- runManualConsolidation ---

describe("runManualConsolidation", () => {
  it("processes all unconsolidated actions regardless of age", async () => {
    // Actions from just 1 hour ago — would be filtered out by normal consolidation
    const oneHourAgo = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const store = createActionStore({
      actions: [
        createAction({ tweetId: "recent-1", date: oneHourAgo }),
        createAction({ tweetId: "recent-2", date: oneHourAgo }),
      ],
    });
    saveActionStore(store, WF);

    const mockCreate = setupMockClient(mockClaudeResponse({
      observations: [{ content: "Manual consolidation ran", priority: 5 }],
      factUpdates: [
        { operation: "ADD", content: "Recent insight from manual run", category: "strategy", confidence: "high" },
      ],
    }));

    await runManualConsolidation(WF);

    // Claude should have been called even though actions are < 12h old
    expect(mockCreate).toHaveBeenCalledOnce();

    // Fact should have been applied
    const facts = readFactStore(WF);
    expect(facts.facts).toHaveLength(1);
    expect(facts.facts[0].content).toBe("Recent insight from manual run");
  });

  it("marks all actions as consolidated after manual run", async () => {
    const store = createActionStore({
      actions: [
        createAction({ tweetId: "m1", date: new Date("2026-02-20T11:00:00Z").toISOString() }),
        createAction({ tweetId: "m2", date: new Date("2026-02-20T11:30:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    setupMockClient(mockClaudeResponse({
      observations: [{ content: "Done", priority: 5 }],
    }));

    await runManualConsolidation(WF);

    const { readActionStore } = await import("@/modules/twitter/memory.actions");
    const updated = readActionStore(WF);
    expect(updated.actions.every((a) => a.consolidated)).toBe(true);
    expect(updated.lastConsolidation).toBe(NOW.toISOString());
  });

  it("does nothing when all actions are already consolidated", async () => {
    const store = createActionStore({
      actions: [
        createAction({ tweetId: "c1", consolidated: true }),
        createAction({ tweetId: "c2", consolidated: true }),
      ],
    });
    saveActionStore(store, WF);

    const mockCreate = setupMockClient(mockClaudeResponse({}));

    await runManualConsolidation(WF);

    // Should not call Claude when there's nothing to process
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("handles mixed consolidated and unconsolidated actions", async () => {
    const store = createActionStore({
      actions: [
        createAction({ tweetId: "old", consolidated: true, date: new Date("2026-02-18T10:00:00Z").toISOString() }),
        createAction({ tweetId: "new1", consolidated: false, date: new Date("2026-02-20T11:00:00Z").toISOString() }),
        createAction({ tweetId: "new2", consolidated: false, date: new Date("2026-02-20T11:15:00Z").toISOString() }),
      ],
    });
    saveActionStore(store, WF);

    const mockCreate = setupMockClient(mockClaudeResponse({
      observations: [{ content: "Partial consolidation", priority: 5 }],
    }));

    await runManualConsolidation(WF);

    // Claude should be called for the 2 unconsolidated actions
    expect(mockCreate).toHaveBeenCalledOnce();

    const { readActionStore } = await import("@/modules/twitter/memory.actions");
    const updated = readActionStore(WF);
    // All three should now be consolidated
    expect(updated.actions.every((a) => a.consolidated)).toBe(true);
  });

  it("applies observations, facts, and relationships from Claude response", async () => {
    const store = createActionStore({
      actions: [
        createAction({
          type: "reply",
          username: "eve",
          text: "Interesting thread on Rust async",
          date: new Date("2026-02-20T10:00:00Z").toISOString(),
        }),
      ],
    });
    saveActionStore(store, WF);

    setupMockClient(mockClaudeResponse({
      observations: [
        { content: "Engaged with Rust community", priority: 8 },
      ],
      factUpdates: [
        { operation: "ADD", content: "Rust async discussions drive engagement", category: "content", confidence: "high" },
      ],
      relationshipUpdates: [
        { username: "eve", topicsToAdd: ["rust", "async"], notes: "Rust expert" },
      ],
    }));

    await runManualConsolidation(WF);

    // All three stores should have received updates
    const facts = readFactStore(WF);
    expect(facts.facts).toHaveLength(1);
    expect(facts.facts[0].content).toContain("Rust async");

    const obs = readObservationStore(WF);
    expect(obs.observations).toHaveLength(1);
    expect(obs.observations[0].content).toBe("Engaged with Rust community");

    const rels = readRelationshipStore(WF);
    const eve = rels.accounts.find((a) => a.username === "eve");
    expect(eve).toBeDefined();
    expect(eve!.topics).toContain("rust");
    expect(eve!.topics).toContain("async");
  });
});
