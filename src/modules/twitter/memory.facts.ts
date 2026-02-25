/**
 * memory.facts.ts — Durable knowledge store extracted by LLM consolidation.
 *
 * Facts are atomic pieces of knowledge that persist across sessions, e.g.:
 *   - "Replies with questions get 3x more engagement" (strategy)
 *   - "@alice is interested in TypeScript and Rust" (account)
 *   - "Best engagement happens 9-11am PST" (timing)
 *
 * Facts are managed via ADD/UPDATE/DELETE operations from the consolidation
 * pipeline. Unlike raw actions, facts stay compact — they represent learned
 * knowledge, not raw history. Typically <50 facts per workflow.
 *
 * Storage: `.runwrk/workflows/<name>/facts.json`
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { workflowFactsPath } from "./workflow";
import type { Fact, FactStore, FactCategory, FactUpdate } from "./memory.types";

// --- Defaults ---

/** Empty fact store */
const EMPTY_STORE: FactStore = { facts: [] };

// --- Persistence Helpers ---

/** Ensure parent directory exists before writing */
function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load facts from disk, falling back to empty defaults */
export function readFactStore(workflowName: string): FactStore {
  const path = workflowFactsPath(workflowName);
  if (!existsSync(path)) return { facts: [] };
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...EMPTY_STORE, ...JSON.parse(raw) };
  } catch {
    return { facts: [] };
  }
}

/** Write the full fact store to disk */
function saveFactStore(store: FactStore, workflowName: string): void {
  const path = workflowFactsPath(workflowName);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

// --- ID Generation ---

/** Generate a simple unique ID for facts (timestamp + random suffix) */
function generateId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Fact CRUD ---

/** Add a new fact to the store */
export function addFact(
  content: string,
  category: FactCategory,
  confidence: "high" | "medium" | "low",
  workflowName: string,
): Fact {
  const store = readFactStore(workflowName);
  const now = new Date().toISOString();
  const fact: Fact = {
    id: generateId(),
    content,
    category,
    confidence,
    createdAt: now,
    updatedAt: now,
  };
  store.facts.push(fact);
  saveFactStore(store, workflowName);
  return fact;
}

/** Update an existing fact by ID — changes content, category, or confidence */
export function updateFact(
  id: string,
  updates: { content?: string; category?: FactCategory; confidence?: "high" | "medium" | "low" },
  workflowName: string,
): boolean {
  const store = readFactStore(workflowName);
  const fact = store.facts.find((f) => f.id === id);
  if (!fact) return false;

  if (updates.content !== undefined) fact.content = updates.content;
  if (updates.category !== undefined) fact.category = updates.category;
  if (updates.confidence !== undefined) fact.confidence = updates.confidence;
  fact.updatedAt = new Date().toISOString();

  saveFactStore(store, workflowName);
  return true;
}

/** Delete a fact by ID */
export function deleteFact(id: string, workflowName: string): boolean {
  const store = readFactStore(workflowName);
  const before = store.facts.length;
  store.facts = store.facts.filter((f) => f.id !== id);
  if (store.facts.length === before) return false;
  saveFactStore(store, workflowName);
  return true;
}

/** Apply a batch of fact updates from the consolidation LLM.
 *  Handles ADD, UPDATE, and DELETE operations in a single pass. */
export function applyFactUpdates(updates: FactUpdate[], workflowName: string): void {
  for (const update of updates) {
    switch (update.operation) {
      case "ADD":
        if (update.content && update.category) {
          addFact(update.content, update.category, update.confidence ?? "medium", workflowName);
        }
        break;
      case "UPDATE":
        if (update.id) {
          updateFact(update.id, {
            content: update.content,
            category: update.category,
            confidence: update.confidence,
          }, workflowName);
        }
        break;
      case "DELETE":
        if (update.id) {
          deleteFact(update.id, workflowName);
        }
        break;
    }
  }
}

// --- Fact Queries ---

/** Confidence tier sort weight — high facts surface first */
function confidenceWeight(c: "high" | "medium" | "low"): number {
  switch (c) {
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
  }
}

/** Get the top N facts sorted by recency + confidence.
 *  High-confidence recent facts surface first. */
export function getTopFacts(n: number = 15, workflowName: string): Fact[] {
  const store = readFactStore(workflowName);
  return [...store.facts]
    .sort((a, b) => {
      // Primary: confidence (high first)
      const cDiff = confidenceWeight(b.confidence) - confidenceWeight(a.confidence);
      if (cDiff !== 0) return cDiff;
      // Secondary: recency (newer first)
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, n);
}
