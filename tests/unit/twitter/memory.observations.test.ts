/**
 * Tests for observation store — verifying read/write persistence,
 * recent observation retrieval with sorting, summary storage,
 * reflection threshold detection, and observation compression
 * into period summaries within a named workflow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { createTestWorkspace, type TestWorkspace } from "../../helpers/fixtures";
import {
  readObservationStore,
  addObservation,
  getRecentObservations,
  getSummaries,
  needsReflection,
  compressObservations,
} from "@/modules/twitter/memory.observations";
import type { Observation, ObservationStore } from "@/modules/twitter/memory.types";
import { workflowObservationsPath } from "@/modules/twitter/workflow";

const WF = "obs-test-wf";
let workspace: TestWorkspace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));
  workspace = createTestWorkspace();
  // Create the workflow directory so observations can be written there
  mkdirSync(join(workspace.workflowsDir, WF), { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  workspace.cleanup();
});

// --- Helper: build an Observation with sensible defaults ---

/** Create a test observation with overridable fields */
function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    date: "2026-02-20",
    sessionId: "sess-001",
    content: "Test observation content.",
    priority: 5,
    ...overrides,
  };
}

// --- readObservationStore ---

describe("readObservationStore", () => {
  it("returns empty defaults when no file exists", () => {
    const store = readObservationStore(WF);

    expect(store.observations).toEqual([]);
    expect(store.summaries).toEqual([]);
  });

  it("loads persisted data after a save round-trip", () => {
    // Add some observations first so the file exists
    addObservation(makeObservation({ content: "First obs" }), WF);
    addObservation(makeObservation({ content: "Second obs", sessionId: "sess-002" }), WF);

    const store = readObservationStore(WF);

    expect(store.observations).toHaveLength(2);
    expect(store.observations[0].content).toBe("First obs");
    expect(store.observations[1].content).toBe("Second obs");
  });
});

// --- addObservation ---

describe("addObservation", () => {
  it("appends an observation and persists to disk", () => {
    const obs = makeObservation({
      content: "Noticed higher engagement on AI threads",
      priority: 7,
      metrics: { actions: 10, replies: 4, likes: 3, skips: 3 },
    });

    addObservation(obs, WF);

    const store = readObservationStore(WF);
    expect(store.observations).toHaveLength(1);
    expect(store.observations[0].content).toBe("Noticed higher engagement on AI threads");
    expect(store.observations[0].priority).toBe(7);
    expect(store.observations[0].metrics).toEqual({
      actions: 10,
      replies: 4,
      likes: 3,
      skips: 3,
    });
  });

  it("appends multiple observations in order", () => {
    addObservation(makeObservation({ content: "Obs A", sessionId: "s1" }), WF);
    addObservation(makeObservation({ content: "Obs B", sessionId: "s2" }), WF);
    addObservation(makeObservation({ content: "Obs C", sessionId: "s3" }), WF);

    const store = readObservationStore(WF);
    expect(store.observations).toHaveLength(3);
    expect(store.observations.map((o) => o.content)).toEqual(["Obs A", "Obs B", "Obs C"]);
  });

  it("preserves existing summaries when appending observations", () => {
    // Seed a store with a summary already present
    const path = workflowObservationsPath(WF);
    const seeded: ObservationStore = {
      observations: [],
      summaries: [{ period: "Feb 1-7", content: "Week 1 summary", createdAt: "2026-02-08T00:00:00Z" }],
    };
    const { writeFileSync } = require("fs");
    writeFileSync(path, JSON.stringify(seeded, null, 2) + "\n");

    addObservation(makeObservation({ content: "New obs" }), WF);

    const store = readObservationStore(WF);
    expect(store.summaries).toHaveLength(1);
    expect(store.summaries[0].content).toBe("Week 1 summary");
    expect(store.observations).toHaveLength(1);
  });
});

// --- getRecentObservations ---

describe("getRecentObservations", () => {
  it("returns observations sorted by date descending", () => {
    addObservation(makeObservation({ date: "2026-02-10", content: "Early", sessionId: "s1" }), WF);
    addObservation(makeObservation({ date: "2026-02-20", content: "Recent", sessionId: "s2" }), WF);
    addObservation(makeObservation({ date: "2026-02-15", content: "Middle", sessionId: "s3" }), WF);

    const recent = getRecentObservations(10, WF);

    expect(recent).toHaveLength(3);
    expect(recent[0].content).toBe("Recent");
    expect(recent[1].content).toBe("Middle");
    expect(recent[2].content).toBe("Early");
  });

  it("limits results to N most recent", () => {
    addObservation(makeObservation({ date: "2026-02-10", content: "Oldest", sessionId: "s1" }), WF);
    addObservation(makeObservation({ date: "2026-02-15", content: "Middle", sessionId: "s2" }), WF);
    addObservation(makeObservation({ date: "2026-02-20", content: "Newest", sessionId: "s3" }), WF);

    const recent = getRecentObservations(2, WF);

    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("Newest");
    expect(recent[1].content).toBe("Middle");
  });

  it("returns empty array when no observations exist", () => {
    const recent = getRecentObservations(5, WF);
    expect(recent).toEqual([]);
  });

  it("returns all observations when N exceeds count", () => {
    addObservation(makeObservation({ date: "2026-02-18", sessionId: "s1" }), WF);
    addObservation(makeObservation({ date: "2026-02-19", sessionId: "s2" }), WF);

    const recent = getRecentObservations(100, WF);
    expect(recent).toHaveLength(2);
  });
});

// --- getSummaries ---

describe("getSummaries", () => {
  it("returns empty array when no summaries exist", () => {
    const summaries = getSummaries(WF);
    expect(summaries).toEqual([]);
  });

  it("returns all period summaries", () => {
    // Seed a store with summaries by doing a compression cycle
    // First, add enough observations to compress
    for (let i = 0; i < 8; i++) {
      addObservation(
        makeObservation({
          date: `2026-02-${String(10 + i).padStart(2, "0")}`,
          sessionId: `s${i}`,
          content: `Observation ${i}`,
        }),
        WF,
      );
    }

    // Compress older observations into a summary, keeping 3 recent
    compressObservations("Summary of Feb 10-14 activity", WF, 3);

    const summaries = getSummaries(WF);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].content).toBe("Summary of Feb 10-14 activity");
    expect(summaries[0].period).toContain("2026-02-10");
  });
});

// --- needsReflection ---

describe("needsReflection", () => {
  it("returns false for an empty store", () => {
    expect(needsReflection(WF)).toBe(false);
  });

  it("returns false for a small store", () => {
    addObservation(makeObservation({ content: "A short observation." }), WF);
    addObservation(makeObservation({ content: "Another short one.", sessionId: "s2" }), WF);

    expect(needsReflection(WF)).toBe(false);
  });

  it("returns true when total content exceeds 60K character threshold", () => {
    // Each observation needs ~6K chars to get above 60K with 10 entries
    const largeContent = "x".repeat(7_000);

    for (let i = 0; i < 10; i++) {
      addObservation(
        makeObservation({
          date: `2026-02-${String(10 + i).padStart(2, "0")}`,
          sessionId: `s${i}`,
          content: largeContent,
        }),
        WF,
      );
    }

    // 10 * 7000 = 70K > 60K threshold
    expect(needsReflection(WF)).toBe(true);
  });

  it("counts summary content toward the threshold too", () => {
    // Add a large summary directly to the store file
    const path = workflowObservationsPath(WF);
    const seeded: ObservationStore = {
      observations: [],
      summaries: [
        {
          period: "Jan 2026",
          content: "y".repeat(61_000),
          createdAt: "2026-02-01T00:00:00Z",
        },
      ],
    };
    const { writeFileSync } = require("fs");
    writeFileSync(path, JSON.stringify(seeded, null, 2) + "\n");

    expect(needsReflection(WF)).toBe(true);
  });
});

// --- compressObservations ---

describe("compressObservations", () => {
  it("moves older observations into a summary and keeps recent N", () => {
    // Add 7 observations spanning a week
    for (let i = 0; i < 7; i++) {
      addObservation(
        makeObservation({
          date: `2026-02-${String(10 + i).padStart(2, "0")}`,
          sessionId: `s${i}`,
          content: `Day ${i} observation`,
        }),
        WF,
      );
    }

    // Compress, keeping the 3 most recent
    compressObservations("Compressed summary of early week", WF, 3);

    const store = readObservationStore(WF);

    // 7 - 3 = 4 observations compressed, 3 kept
    expect(store.observations).toHaveLength(3);
    // Remaining should be the most recent (sorted ascending after compression)
    expect(store.observations[0].date).toBe("2026-02-14");
    expect(store.observations[1].date).toBe("2026-02-15");
    expect(store.observations[2].date).toBe("2026-02-16");

    // One summary should exist with the compressed content
    expect(store.summaries).toHaveLength(1);
    expect(store.summaries[0].content).toBe("Compressed summary of early week");
  });

  it("generates correct period label from date range", () => {
    addObservation(makeObservation({ date: "2026-02-05", sessionId: "s1", content: "A" }), WF);
    addObservation(makeObservation({ date: "2026-02-12", sessionId: "s2", content: "B" }), WF);
    addObservation(makeObservation({ date: "2026-02-19", sessionId: "s3", content: "C" }), WF);

    // Compress, keeping 1 most recent — so 2 get compressed (Feb 05 and Feb 12)
    compressObservations("Two-week summary", WF, 1);

    const summaries = getSummaries(WF);
    expect(summaries).toHaveLength(1);
    // Period should span from first compressed to last compressed date
    expect(summaries[0].period).toBe("2026-02-05 to 2026-02-12");
  });

  it("generates single-date period when all compressed observations share a date", () => {
    addObservation(makeObservation({ date: "2026-02-10", sessionId: "s1", content: "Morning session" }), WF);
    addObservation(makeObservation({ date: "2026-02-10", sessionId: "s2", content: "Afternoon session" }), WF);
    addObservation(makeObservation({ date: "2026-02-20", sessionId: "s3", content: "Later session" }), WF);

    // Compress, keeping 1 — the two Feb 10 observations get compressed
    compressObservations("Same-day summary", WF, 1);

    const summaries = getSummaries(WF);
    expect(summaries[0].period).toBe("2026-02-10");
  });

  it("does nothing when there are fewer observations than keepRecent", () => {
    addObservation(makeObservation({ date: "2026-02-18", sessionId: "s1", content: "A" }), WF);
    addObservation(makeObservation({ date: "2026-02-19", sessionId: "s2", content: "B" }), WF);

    // keepRecent=5 but only 2 observations — nothing to compress
    compressObservations("Should not be stored", WF, 5);

    const store = readObservationStore(WF);
    expect(store.observations).toHaveLength(2);
    expect(store.summaries).toHaveLength(0);
  });

  it("uses default keepRecent of 5 when not specified", () => {
    // Add 8 observations
    for (let i = 0; i < 8; i++) {
      addObservation(
        makeObservation({
          date: `2026-02-${String(10 + i).padStart(2, "0")}`,
          sessionId: `s${i}`,
          content: `Observation ${i}`,
        }),
        WF,
      );
    }

    // Default keepRecent=5 → 3 compressed, 5 kept
    compressObservations("Default keepRecent summary", WF);

    const store = readObservationStore(WF);
    expect(store.observations).toHaveLength(5);
    expect(store.summaries).toHaveLength(1);
    expect(store.summaries[0].content).toBe("Default keepRecent summary");
  });

  it("accumulates summaries across multiple compression passes", () => {
    // First pass: add 10 observations, compress keeping 3
    for (let i = 0; i < 10; i++) {
      addObservation(
        makeObservation({
          date: `2026-02-${String(1 + i).padStart(2, "0")}`,
          sessionId: `s${i}`,
          content: `Week 1 observation ${i}`,
        }),
        WF,
      );
    }
    compressObservations("First compression pass", WF, 3);

    // Second pass: add 5 more, compress again keeping 3
    for (let i = 0; i < 5; i++) {
      addObservation(
        makeObservation({
          date: `2026-02-${String(15 + i).padStart(2, "0")}`,
          sessionId: `s2-${i}`,
          content: `Week 2 observation ${i}`,
        }),
        WF,
      );
    }
    compressObservations("Second compression pass", WF, 3);

    const store = readObservationStore(WF);

    // Two summaries accumulated
    expect(store.summaries).toHaveLength(2);
    expect(store.summaries[0].content).toBe("First compression pass");
    expect(store.summaries[1].content).toBe("Second compression pass");

    // 3 most recent observations kept from the second pass
    expect(store.observations).toHaveLength(3);
  });
});
