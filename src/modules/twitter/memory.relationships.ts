/**
 * memory.relationships.ts — Per-account relationship tracking (CRM layer).
 *
 * Tracks every account we interact with: how often, in which direction,
 * on what topics, and how "warm" the relationship is. This data helps the
 * agent prioritize engaging with accounts that engage back (high reciprocity)
 * and avoid wasting effort on cold, one-sided interactions.
 *
 * Warmth auto-escalates based on interaction count:
 *   cold (0-2 interactions) → warm (3-6) → hot (7+)
 *
 * Reciprocity score measures balance: positive means they engage more with us
 * than we do with them (good), negative means we're over-investing.
 *
 * Storage: `.myteam/workflows/<name>/relationships.json`
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { workflowRelationshipsPath } from "./workflow";
import type {
  AccountRelationship,
  RelationshipStore,
  RelationshipUpdate,
  WarmthTier,
  InteractionDirection,
} from "./memory.types";

// --- Defaults ---

/** Empty relationship store */
const EMPTY_STORE: RelationshipStore = { accounts: [] };

// --- Persistence Helpers ---

/** Ensure parent directory exists */
function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load relationships from disk, falling back to empty defaults */
export function readRelationshipStore(workflowName: string): RelationshipStore {
  const path = workflowRelationshipsPath(workflowName);
  if (!existsSync(path)) return { accounts: [] };
  try {
    const raw = readFileSync(path, "utf-8");
    return { ...EMPTY_STORE, ...JSON.parse(raw) };
  } catch {
    return { accounts: [] };
  }
}

/** Write relationship store to disk */
function saveRelationshipStore(store: RelationshipStore, workflowName: string): void {
  const path = workflowRelationshipsPath(workflowName);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

// --- Warmth Computation ---

/** Compute warmth tier from raw interaction count */
function computeWarmth(interactions: number): WarmthTier {
  if (interactions >= 7) return "hot";
  if (interactions >= 3) return "warm";
  return "cold";
}

// --- Account CRUD ---

/** Find an existing account or create a new one with defaults.
 *  Normalizes username to lowercase without @ prefix. */
export function getOrCreateRelationship(
  username: string,
  workflowName: string,
): AccountRelationship {
  const normalized = username.toLowerCase().replace(/^@/, "");
  const store = readRelationshipStore(workflowName);
  let account = store.accounts.find((a) => a.username === normalized);

  if (!account) {
    const now = new Date().toISOString();
    account = {
      username: normalized,
      followStatus: "none",
      warmth: "cold",
      firstSeen: now,
      lastInteraction: now,
      interactions: 0,
      topics: [],
      notes: "",
      reciprocityScore: 0,
    };
    store.accounts.push(account);
    saveRelationshipStore(store, workflowName);
  }

  return account;
}

// --- Interaction Recording ---

/** Check if an interaction direction is "ours" (we initiated) */
function isOurInteraction(direction: InteractionDirection): boolean {
  return direction.startsWith("our-");
}

/** Record an interaction with an account.
 *  Increments interaction count, updates warmth tier, and refreshes lastInteraction. */
export function recordInteraction(
  username: string,
  direction: InteractionDirection,
  workflowName: string,
): void {
  const normalized = username.toLowerCase().replace(/^@/, "");
  const store = readRelationshipStore(workflowName);

  // Find or create the account entry
  let account = store.accounts.find((a) => a.username === normalized);
  if (!account) {
    const now = new Date().toISOString();
    account = {
      username: normalized,
      followStatus: "none",
      warmth: "cold",
      firstSeen: now,
      lastInteraction: now,
      interactions: 0,
      topics: [],
      notes: "",
      reciprocityScore: 0,
    };
    store.accounts.push(account);
  }

  // Update interaction tracking
  account.interactions++;
  account.lastInteraction = new Date().toISOString();
  account.warmth = computeWarmth(account.interactions);

  // Update follow status for follow interactions
  if (direction === "our-follow") {
    account.followStatus = account.followStatus === "they-follow" ? "mutual" : "we-follow";
  }

  // Nudge reciprocity score based on direction
  // Ours = we're investing, so score decreases slightly
  // Theirs = they're engaging back, so score increases
  const nudge = isOurInteraction(direction) ? -0.1 : 0.15;
  account.reciprocityScore = Math.max(-1, Math.min(1, account.reciprocityScore + nudge));

  saveRelationshipStore(store, workflowName);
}

// --- Queries ---

/** Get the top N relationships sorted by warmth (hot first) then recency */
export function getTopRelationships(n: number = 10, workflowName: string): AccountRelationship[] {
  const store = readRelationshipStore(workflowName);

  /** Warmth tier sort weight */
  function warmthWeight(w: WarmthTier): number {
    switch (w) {
      case "hot": return 3;
      case "warm": return 2;
      case "cold": return 1;
    }
  }

  return [...store.accounts]
    .sort((a, b) => {
      // Primary: warmth (hot first)
      const wDiff = warmthWeight(b.warmth) - warmthWeight(a.warmth);
      if (wDiff !== 0) return wDiff;
      // Secondary: recency (newer first)
      return b.lastInteraction.localeCompare(a.lastInteraction);
    })
    .slice(0, n);
}

// --- Bulk Updates from Consolidation ---

/** Apply a batch of relationship updates from the consolidation LLM.
 *  Handles warmth changes, topic additions, and notes. */
export function applyRelationshipUpdates(
  updates: RelationshipUpdate[],
  workflowName: string,
): void {
  const store = readRelationshipStore(workflowName);

  for (const update of updates) {
    const normalized = update.username.toLowerCase().replace(/^@/, "");
    let account = store.accounts.find((a) => a.username === normalized);

    // Create the account if it doesn't exist yet
    if (!account) {
      const now = new Date().toISOString();
      account = {
        username: normalized,
        followStatus: "none",
        warmth: "cold",
        firstSeen: now,
        lastInteraction: now,
        interactions: 0,
        topics: [],
        notes: "",
        reciprocityScore: 0,
      };
      store.accounts.push(account);
    }

    // Apply warmth change (maps to interaction count adjustment)
    if (update.warmthChange !== undefined && update.warmthChange !== 0) {
      account.interactions = Math.max(0, account.interactions + update.warmthChange);
      account.warmth = computeWarmth(account.interactions);
    }

    // Add new topics (deduplicated)
    if (update.topicsToAdd?.length) {
      const existing = new Set(account.topics);
      for (const topic of update.topicsToAdd) {
        if (!existing.has(topic)) {
          account.topics.push(topic);
        }
      }
    }

    // Append notes with timestamp
    if (update.notes) {
      const timestamp = new Date().toISOString().slice(0, 10);
      account.notes += (account.notes ? " | " : "") + `[${timestamp}] ${update.notes}`;
    }
  }

  saveRelationshipStore(store, workflowName);
}
