/**
 * memory.observations.ts — Session-level summaries from LLM consolidation.
 *
 * After each consolidation, the LLM produces 1-3 observations about what
 * happened in the session — patterns noticed, strategy insights, performance
 * notes. These are richer than raw action counts but more ephemeral than facts.
 *
 * When observations grow too large (~15K tokens), a "reflection" pass compresses
 * older observations into period summaries (e.g., "Feb 10-17: focused on AI
 * threads, engagement improved 20%"). This keeps the file bounded.
 *
 * Storage: `.runwrk/workflows/<name>/observations.json`
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { workflowObservationsPath } from "./workflow";
import type { Observation, ObservationSummary, ObservationStore } from "./memory.types";

// --- Defaults ---

/** Empty observation store */
const EMPTY_STORE: ObservationStore = { observations: [], summaries: [] };

/** Approximate token threshold before triggering reflection (~15K tokens = ~60K chars / 4) */
const REFLECTION_CHAR_THRESHOLD = 60_000;

// --- Persistence Helpers ---

/** Ensure parent directory exists */
function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load observations from disk, falling back to empty defaults */
export function readObservationStore(workflowName: string): ObservationStore {
  const path = workflowObservationsPath(workflowName);
  if (!existsSync(path)) return { observations: [], summaries: [] };
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...EMPTY_STORE, ...JSON.parse(raw) };
  } catch {
    return { observations: [], summaries: [] };
  }
}

/** Write observation store to disk */
function saveObservationStore(store: ObservationStore, workflowName: string): void {
  const path = workflowObservationsPath(workflowName);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

// --- Observation CRUD ---

/** Add a new session observation from the consolidation pipeline */
export function addObservation(observation: Observation, workflowName: string): void {
  const store = readObservationStore(workflowName);
  store.observations.push(observation);
  saveObservationStore(store, workflowName);
}

/** Get the N most recent observations, sorted by date descending */
export function getRecentObservations(n: number = 5, workflowName: string): Observation[] {
  const store = readObservationStore(workflowName);
  return [...store.observations]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

/** Get all period summaries (compressed older observations) */
export function getSummaries(workflowName: string): ObservationSummary[] {
  return readObservationStore(workflowName).summaries;
}

// --- Reflection (Compression) ---

/** Estimate total character count across all observations — rough token proxy */
function totalObservationSize(store: ObservationStore): number {
  let size = 0;
  for (const obs of store.observations) {
    size += obs.content.length;
  }
  for (const summary of store.summaries) {
    size += summary.content.length;
  }
  return size;
}

/** Check if observations have grown large enough to warrant a reflection pass.
 *  Uses character count / 4 as a rough token estimate. */
export function needsReflection(workflowName: string): boolean {
  const store = readObservationStore(workflowName);
  return totalObservationSize(store) > REFLECTION_CHAR_THRESHOLD;
}

/** Compress older observations into a period summary.
 *  Called after the reflection LLM generates a compressed summary.
 *  Keeps the most recent `keepRecent` observations and removes the rest.
 *
 *  @param summaryContent — The compressed text from the reflection LLM
 *  @param keepRecent — How many recent observations to preserve (default 5) */
export function compressObservations(
  summaryContent: string,
  workflowName: string,
  keepRecent: number = 5,
): void {
  const store = readObservationStore(workflowName);

  // Sort observations by date — oldest first
  store.observations.sort((a, b) => a.date.localeCompare(b.date));

  // Determine the period covered by observations being compressed
  const toCompress = store.observations.slice(0, -keepRecent);
  if (toCompress.length === 0) return;

  const firstDate = toCompress[0].date.slice(0, 10);
  const lastDate = toCompress[toCompress.length - 1].date.slice(0, 10);
  const period = firstDate === lastDate ? firstDate : `${firstDate} to ${lastDate}`;

  // Add the compressed summary
  store.summaries.push({
    period,
    content: summaryContent,
    createdAt: new Date().toISOString(),
  });

  // Keep only the most recent observations
  store.observations = store.observations.slice(-keepRecent);

  saveObservationStore(store, workflowName);
}
