/**
 * memory.working.ts — Assembles the "working memory" block injected into Claude's prompt.
 *
 * This is the bridge between storage and the LLM. It pulls from all four storage
 * layers (actions, facts, observations, relationships) and compresses them into a
 * single ~2-3K token block. No matter how many sessions have run, this block stays
 * roughly the same size — that's the key design goal.
 *
 * The working memory has five sections:
 *   1. Performance snapshot — 7-day stats (replies, likes, skip rate, etc.)
 *   2. Known facts — top 15 durable insights sorted by recency + confidence
 *   3. Session notes — last 5 observations from consolidation
 *   4. Key relationships — top 10 accounts by warmth + recency
 *   5. User directives — explicit feedback rules from the user
 */

import { getDailyStats, getSkipPatterns, readActionStore } from "./memory.actions";
import { getTopFacts } from "./memory.facts";
import { getRecentObservations, getSummaries } from "./memory.observations";
import { getTopRelationships } from "./memory.relationships";
import type { WorkingMemory, PerformanceSnapshot, DayStats } from "./memory.types";

// --- Performance Snapshot ---

/** Build a 7-day performance snapshot from daily stats */
function buildPerformanceSnapshot(workflowName: string): PerformanceSnapshot {
  const stats = getDailyStats(workflowName);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  // Aggregate stats from the last 7 days
  let totalActions = 0;
  let replies = 0;
  let likes = 0;
  let follows = 0;

  for (const [day, dayStat] of Object.entries(stats)) {
    if (day >= cutoff) {
      replies += dayStat.replies;
      likes += dayStat.likes;
      follows += dayStat.follows;
      totalActions += dayStat.replies + dayStat.likes + dayStat.posts + dayStat.follows + dayStat.retweets;
    }
  }

  // Count skips separately (they're in actions but not in DayStats)
  const store = readActionStore(workflowName);
  const skips = store.actions.filter(
    (a) => a.type === "skip" && a.date.slice(0, 10) >= cutoff,
  ).length;
  totalActions += skips;

  const skipRate = totalActions > 0 ? skips / totalActions : 0;

  return {
    period: `${cutoff} to ${now.toISOString().slice(0, 10)}`,
    totalActions,
    replies,
    likes,
    follows,
    skips,
    skipRate: Math.round(skipRate * 100) / 100, // Round to 2 decimal places
  };
}

// --- Working Memory Assembly ---

/** Assemble the full working memory object from all storage layers.
 *  This is the raw data — use formatWorkingMemoryForPrompt() to render it. */
export function buildWorkingMemory(workflowName: string): WorkingMemory {
  const store = readActionStore(workflowName);

  return {
    performance: buildPerformanceSnapshot(workflowName),
    facts: getTopFacts(15, workflowName),
    observations: getRecentObservations(5, workflowName),
    relationships: getTopRelationships(10, workflowName),
    directives: store.directives,
    skipPatterns: getSkipPatterns(30, workflowName),
  };
}

// --- Prompt Formatting ---

/** Render working memory as a markdown string for injection into the system prompt.
 *  Each section is capped to prevent bloat — the total stays under ~2-3K tokens. */
export function formatWorkingMemoryForPrompt(wm: WorkingMemory): string {
  const sections: string[] = [];

  // --- Section 1: Performance ---
  const perf = wm.performance;
  if (perf.totalActions > 0) {
    sections.push(
      `### Performance (last 7 days)\n` +
      `${perf.replies} replies, ${perf.likes} likes, ${perf.follows} follows, ` +
      `${perf.skips} skips (${Math.round(perf.skipRate * 100)}% skip rate) — ` +
      `${perf.totalActions} total actions`,
    );
  }

  // --- Section 2: Known Facts ---
  if (wm.facts.length > 0) {
    const factLines = wm.facts
      .map((f) => `- [${f.confidence}] ${f.content}`)
      .join("\n");
    sections.push(`### Known Facts\n${factLines}`);
  }

  // --- Section 3: Session Notes ---
  if (wm.observations.length > 0) {
    const obsLines = wm.observations
      .map((o) => `- [${o.date.slice(0, 10)}] ${o.content}`)
      .join("\n");
    sections.push(`### Recent Session Notes\n${obsLines}`);
  }

  // --- Section 4: Key Relationships ---
  if (wm.relationships.length > 0) {
    const relLines = wm.relationships
      .map((r) => {
        const warmthBadge = r.warmth === "hot" ? "**HOT**" : r.warmth === "warm" ? "warm" : "cold";
        const topics = r.topics.length > 0 ? ` (${r.topics.slice(0, 3).join(", ")})` : "";
        return `- @${r.username} [${warmthBadge}, ${r.interactions} interactions]${topics}`;
      })
      .join("\n");
    sections.push(`### Key Relationships\n${relLines}`);
  }

  // --- Section 5: User Directives ---
  if (wm.directives.length > 0) {
    const dirLines = wm.directives.map((d) => `- ${d}`).join("\n");
    sections.push(
      `### User Directives\n${dirLines}\n` +
      `Follow these directives strictly — they reflect the user's explicit preferences.`,
    );
  }

  // --- Section 6: Skip Patterns (learned avoidance) ---
  if (wm.skipPatterns) {
    sections.push(
      `### Learned Skip Patterns\n${wm.skipPatterns}\n` +
      `Skip tweets matching these patterns proactively.`,
    );
  }

  if (sections.length === 0) {
    return "No memory data yet — this is a new workflow.";
  }

  return sections.join("\n\n");
}
