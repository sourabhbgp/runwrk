/**
 * memory.types.ts — Type definitions for the tiered memory system.
 *
 * The memory system has four layers:
 *   1. Actions   — raw engagement log (every reply, like, skip recorded as-is)
 *   2. Facts     — atomic durable knowledge extracted by LLM consolidation
 *   3. Observations — session-level summaries and compressed period insights
 *   4. Relationships — per-account CRM tracking engagement warmth and reciprocity
 *
 * These types are consumed by the storage modules (memory.actions.ts, memory.facts.ts,
 * etc.) and by the working memory assembler that builds the prompt context.
 */

// --- Action Log Types ---

/** All action types the system can record */
export type ActionType = "reply" | "like" | "retweet" | "post" | "follow" | "skip";

/** A single raw engagement action — the atomic unit of the action log */
export interface Action {
  type: ActionType;
  tweetId?: string;
  userId?: string;
  username?: string;
  /** Reply text (for replies) or skip reason (for skips) */
  text?: string;
  /** Skip reason — only present when type is 'skip' */
  reason?: string;
  /** ISO timestamp of when the action occurred */
  date: string;
  /** True once this action has been processed by the consolidation pipeline */
  consolidated: boolean;
}

/** Persistent storage format for the action log */
export interface ActionStore {
  actions: Action[];
  /** User-provided feedback directives (e.g. "be funnier", "avoid crypto") */
  directives: string[];
  /** ISO timestamp of the last successful consolidation run, or null if never run */
  lastConsolidation: string | null;
}

/** Aggregate action counts for a single day — used for rate limiting and stats */
export interface DayStats {
  replies: number;
  likes: number;
  posts: number;
  follows: number;
  retweets: number;
}

// --- Fact Types ---

/** Categories for organizing extracted facts */
export type FactCategory = "strategy" | "content" | "timing" | "audience" | "account";

/** An atomic piece of durable knowledge extracted by the consolidation LLM */
export interface Fact {
  /** Unique identifier (nanoid or sequential) */
  id: string;
  /** The knowledge itself — a single clear statement */
  content: string;
  category: FactCategory;
  /** How confident the LLM is in this fact */
  confidence: "high" | "medium" | "low";
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update (may differ from createdAt after UPDATE operations) */
  updatedAt: string;
}

/** Persistent storage format for the fact store */
export interface FactStore {
  facts: Fact[];
}

// --- Observation Types ---

/** A session-level summary produced by the consolidation LLM */
export interface Observation {
  /** ISO date (YYYY-MM-DD) of the session */
  date: string;
  /** Unique session identifier (used to group actions into sessions) */
  sessionId: string;
  /** The observation text — what the LLM noticed about this session */
  content: string;
  /** How important this observation is (higher = more important, 1-10) */
  priority: number;
  /** Optional session metrics snapshot */
  metrics?: {
    actions: number;
    replies: number;
    likes: number;
    skips: number;
  };
}

/** A compressed summary covering multiple sessions over a time period */
export interface ObservationSummary {
  /** Human-readable period label (e.g. "Feb 10-17") */
  period: string;
  /** Compressed summary content produced by the reflection LLM pass */
  content: string;
  /** ISO timestamp of when this summary was generated */
  createdAt: string;
}

/** Persistent storage format for observations */
export interface ObservationStore {
  observations: Observation[];
  summaries: ObservationSummary[];
}

// --- Relationship Types ---

/** Warmth tiers for relationship tracking */
export type WarmthTier = "cold" | "warm" | "hot";

/** Interaction direction — who initiated the engagement */
export type InteractionDirection = "our-reply" | "our-like" | "our-retweet" | "our-follow" | "their-mention" | "their-reply";

/** Per-account relationship data — the CRM layer */
export interface AccountRelationship {
  username: string;
  /** Whether we follow this account, they follow us, or mutual */
  followStatus: "none" | "we-follow" | "they-follow" | "mutual";
  /** Auto-computed warmth tier based on interaction count */
  warmth: WarmthTier;
  /** ISO timestamp of first interaction */
  firstSeen: string;
  /** ISO timestamp of most recent interaction */
  lastInteraction: string;
  /** Total interaction count (both directions) */
  interactions: number;
  /** Topics we've discussed with this account */
  topics: string[];
  /** Free-form notes from the consolidation LLM */
  notes: string;
  /** Balance metric: positive = they engage more with us, negative = we over-invest */
  reciprocityScore: number;
}

/** Persistent storage format for the relationship store */
export interface RelationshipStore {
  accounts: AccountRelationship[];
}

// --- Consolidation Types (LLM input/output) ---

/** A single fact operation returned by the consolidation LLM */
export interface FactUpdate {
  operation: "ADD" | "UPDATE" | "DELETE";
  /** Required for UPDATE and DELETE — the fact ID to modify */
  id?: string;
  /** Required for ADD and UPDATE — the fact text */
  content?: string;
  category?: FactCategory;
  confidence?: "high" | "medium" | "low";
}

/** A single relationship update returned by the consolidation LLM */
export interface RelationshipUpdate {
  username: string;
  /** Change to warmth: positive = warmer, negative = cooler */
  warmthChange?: number;
  /** Topics to add to this account's profile */
  topicsToAdd?: string[];
  /** Free-form notes to append */
  notes?: string;
}

/** The full result returned by the consolidation LLM */
export interface ConsolidationResult {
  /** 1-3 session observations */
  observations: Array<{
    content: string;
    priority: number;
    metrics?: { actions: number; replies: number; likes: number; skips: number };
  }>;
  /** Fact add/update/delete operations */
  factUpdates: FactUpdate[];
  /** Relationship notes and warmth adjustments */
  relationshipUpdates: RelationshipUpdate[];
}

// --- Working Memory Types (prompt assembly) ---

/** 7-day performance snapshot for the prompt */
export interface PerformanceSnapshot {
  period: string;
  totalActions: number;
  replies: number;
  likes: number;
  follows: number;
  skips: number;
  /** Fraction of actions that were skips (0-1) */
  skipRate: number;
}

/** The assembled working memory block injected into the system prompt */
export interface WorkingMemory {
  performance: PerformanceSnapshot;
  facts: Fact[];
  observations: Observation[];
  relationships: AccountRelationship[];
  directives: string[];
  skipPatterns: string;
}
