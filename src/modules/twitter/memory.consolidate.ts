/**
 * memory.consolidate.ts — Daily LLM-powered extraction pipeline.
 *
 * Consolidation is the process that turns raw actions into structured knowledge.
 * It runs once per day (triggered at session end if >24h since last run), NOT
 * after every session — because engagement (follow-backs, reply engagement)
 * takes time to materialize.
 *
 * Pipeline:
 *   1. Read unconsolidated actions older than 12h (gives time for engagement)
 *   2. Group actions into logical sessions (30-min gap = new session)
 *   3. Send to Claude with workflow context + existing facts
 *   4. Claude returns: observations, fact updates (ADD/UPDATE/DELETE), relationship notes
 *   5. Apply all updates to the respective stores
 *   6. If observations file is getting large, run a "reflection" pass to compress
 *
 * The consolidation prompt asks Claude to think like a social media strategist:
 *   - What patterns do you see? (→ observations)
 *   - What durable knowledge can you extract? (→ facts)
 *   - What did you learn about specific accounts? (→ relationships)
 */

import { createAnthropicClient } from "../auth";
import { readEnv, spinner, success, info, error as logError, getLogger } from "../../common";
import { readActionStore, getUnconsolidated, markConsolidated } from "./memory.actions";
import { getTopFacts, readFactStore, applyFactUpdates } from "./memory.facts";
import { addObservation, needsReflection, compressObservations, readObservationStore } from "./memory.observations";
import { applyRelationshipUpdates } from "./memory.relationships";
import { readWorkflowConfig } from "./workflow";
import type { Action, ConsolidationResult } from "./memory.types";
import type { WorkflowConfig } from "./workflow.types";

// --- Constants ---

/** Minimum hours between automatic consolidation runs */
const CONSOLIDATION_INTERVAL_HOURS = 24;

/** Actions must be at least this old before consolidation (gives engagement time to materialize) */
const MIN_ACTION_AGE_HOURS = 12;

/** Gap in minutes that defines a session boundary when grouping actions */
const SESSION_GAP_MINUTES = 30;

// --- Session Grouping ---

/** Group a flat list of actions into logical sessions based on time gaps.
 *  A gap of >30 minutes between consecutive actions starts a new session. */
function groupIntoSessions(actions: Action[]): Action[][] {
  if (actions.length === 0) return [];

  // Sort by date ascending
  const sorted = [...actions].sort((a, b) => a.date.localeCompare(b.date));
  const sessions: Action[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].date).getTime();
    const curr = new Date(sorted[i].date).getTime();
    const gapMinutes = (curr - prev) / (1000 * 60);

    if (gapMinutes > SESSION_GAP_MINUTES) {
      // Start a new session
      sessions.push([sorted[i]]);
    } else {
      // Continue current session
      sessions[sessions.length - 1].push(sorted[i]);
    }
  }

  return sessions;
}

/** Generate a unique session ID from the first action's timestamp */
function sessionId(session: Action[]): string {
  return `s_${session[0].date.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

// --- Prompt Construction ---

/** Format a list of actions into readable text for the consolidation prompt */
function formatActionsForPrompt(actions: Action[]): string {
  return actions.map((a) => {
    const parts: string[] = [a.type];
    if (a.username) parts.push(`@${a.username}`);
    if (a.text) parts.push(`"${a.text.slice(0, 100)}"`);
    if (a.reason) parts.push(`reason: ${a.reason}`);
    parts.push(`at ${a.date}`);
    return `- ${parts.join(" | ")}`;
  }).join("\n");
}

/** Build the consolidation prompt sent to Claude */
function buildConsolidationPrompt(
  sessions: Action[][],
  workflow: WorkflowConfig,
  existingFacts: string,
): string {
  const sessionBlocks = sessions.map((session, i) => {
    const id = sessionId(session);
    const actions = formatActionsForPrompt(session);
    const counts = {
      total: session.length,
      replies: session.filter((a) => a.type === "reply").length,
      likes: session.filter((a) => a.type === "like").length,
      skips: session.filter((a) => a.type === "skip").length,
    };
    return `### Session ${i + 1} (${id})\nActions: ${counts.total} total (${counts.replies} replies, ${counts.likes} likes, ${counts.skips} skips)\n${actions}`;
  }).join("\n\n");

  return `You are a social media strategist analyzing engagement sessions for a Twitter workflow.

## Workflow Context
Name: ${workflow.name}
Strategy: ${workflow.strategyPrompt}
Topics: ${workflow.topics.join(", ")}

## Existing Facts
${existingFacts || "No facts yet — this is the first consolidation."}

## Recent Sessions
${sessionBlocks}

## Your Task
Analyze these sessions and extract structured knowledge. Think about:
1. **Observations**: What happened in each session? What patterns do you notice? (1-3 per session)
2. **Fact Updates**: What durable knowledge can you extract or update? Think about content strategy, timing, audience behavior. Use ADD for new facts, UPDATE to refine existing ones (include the id), DELETE to remove outdated ones.
3. **Relationship Notes**: What did you learn about specific accounts? Who engages back? Who should we focus on?

Respond in this exact JSON format (no markdown, no code fences):
{
  "observations": [
    {"content": "observation text", "priority": 1-10, "metrics": {"actions": N, "replies": N, "likes": N, "skips": N}}
  ],
  "factUpdates": [
    {"operation": "ADD|UPDATE|DELETE", "id": "existing-id-for-update-delete", "content": "fact text", "category": "strategy|content|timing|audience|account", "confidence": "high|medium|low"}
  ],
  "relationshipUpdates": [
    {"username": "handle", "warmthChange": 0, "topicsToAdd": ["topic"], "notes": "what you learned"}
  ]
}`;
}

/** Build the reflection prompt for compressing old observations */
function buildReflectionPrompt(observations: string): string {
  return `You are summarizing a series of engagement session observations into a compressed period summary.

## Observations to Compress
${observations}

## Your Task
Write a concise 2-4 sentence summary that captures the key patterns, insights, and trends from these observations. Focus on what's strategically important — not individual session details.

Respond with ONLY the summary text, nothing else.`;
}

// --- Consolidation Checks ---

/** Check if consolidation should run — true if >24h since last run AND there are old enough actions */
export function needsConsolidation(workflowName: string): boolean {
  const store = readActionStore(workflowName);

  // Check time since last consolidation
  if (store.lastConsolidation) {
    const lastRun = new Date(store.lastConsolidation).getTime();
    const hoursSince = (Date.now() - lastRun) / (1000 * 60 * 60);
    if (hoursSince < CONSOLIDATION_INTERVAL_HOURS) return false;
  }

  // Check if there are unconsolidated actions old enough
  const unconsolidated = getUnconsolidated(workflowName, MIN_ACTION_AGE_HOURS);
  return unconsolidated.length > 0;
}

// --- Main Pipeline ---

/** Run the consolidation pipeline — extract facts, observations, and relationship data
 *  from unconsolidated actions using Claude.
 *
 *  @param workflowName — which workflow to consolidate
 *  @param workflow — optional pre-loaded config (loaded from disk if not provided) */
export async function runConsolidation(
  workflowName: string,
  workflow?: WorkflowConfig,
): Promise<void> {
  // Load workflow config if not provided
  const wf = workflow ?? readWorkflowConfig(workflowName);

  // Step 1: Get unconsolidated actions older than 12h
  const unconsolidated = getUnconsolidated(workflowName, MIN_ACTION_AGE_HOURS);
  if (unconsolidated.length === 0) {
    info("No actions to consolidate.");
    return;
  }

  // Step 2: Group into sessions
  const sessions = groupIntoSessions(unconsolidated);
  if (sessions.length === 0) return;

  // Step 3: Build prompt with existing facts context
  const existingFacts = getTopFacts(20, workflowName)
    .map((f) => `[${f.id}] [${f.category}/${f.confidence}] ${f.content}`)
    .join("\n");

  const prompt = buildConsolidationPrompt(sessions, wf, existingFacts);

  // Step 4: Call Claude
  const env = readEnv();
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logError("No Anthropic API key. Run `runwrk setup` first.");
    return;
  }

  const client = createAnthropicClient(apiKey);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = response.content[0].type === "text" ? response.content[0].text : "";

  const log = getLogger().child({ component: "twitter", workflow: workflowName });

  let result: ConsolidationResult;
  try {
    result = JSON.parse(responseText.trim());
  } catch (e: unknown) {
    logError("Failed to parse consolidation response. Skipping this run.");
    log.warn({ err: e, responseText: responseText.slice(0, 200) }, "Consolidation parse failed");
    return;
  }

  log.info({
    sessions: sessions.length,
    actions: unconsolidated.length,
    observations: result.observations?.length ?? 0,
    factUpdates: result.factUpdates?.length ?? 0,
    relationshipUpdates: result.relationshipUpdates?.length ?? 0,
  }, "Consolidation complete");

  // Step 5: Apply all updates

  // Add observations
  for (const obs of result.observations ?? []) {
    // Use the first session's data for metadata
    const session = sessions[0];
    addObservation({
      date: session[0].date,
      sessionId: sessionId(session),
      content: obs.content,
      priority: obs.priority ?? 5,
      metrics: obs.metrics,
    }, workflowName);
  }

  // Apply fact updates
  if (result.factUpdates?.length) {
    applyFactUpdates(result.factUpdates, workflowName);
  }

  // Apply relationship updates
  if (result.relationshipUpdates?.length) {
    applyRelationshipUpdates(result.relationshipUpdates, workflowName);
  }

  // Step 6: Mark actions as consolidated
  const latestDate = unconsolidated
    .map((a) => a.date)
    .sort()
    .pop() ?? new Date().toISOString();
  markConsolidated(latestDate, workflowName);

  // Step 7: Check if observations need reflection (compression)
  if (needsReflection(workflowName)) {
    await runReflection(workflowName);
  }
}

// --- Reflection (Observation Compression) ---

/** Run a reflection pass — compress older observations into a period summary.
 *  Called automatically when observations exceed the size threshold. */
async function runReflection(workflowName: string): Promise<void> {
  const store = readObservationStore(workflowName);
  if (store.observations.length <= 5) return; // Nothing to compress

  // Format older observations for the reflection prompt
  const toCompress = store.observations.slice(0, -5);
  const obsText = toCompress
    .map((o) => `[${o.date.slice(0, 10)}] (priority ${o.priority}) ${o.content}`)
    .join("\n");

  const prompt = buildReflectionPrompt(obsText);

  const env = readEnv();
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const client = createAnthropicClient(apiKey);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const summary = response.content[0].type === "text" ? response.content[0].text.trim() : "";
  if (summary) {
    compressObservations(summary, workflowName, 5);
  }
}

// --- CLI Entry Points ---

/** Run consolidation manually from the CLI — skips the 24h interval check.
 *  Shows progress with spinners and success/error messages. */
export async function runManualConsolidation(workflowName: string): Promise<void> {
  const wf = readWorkflowConfig(workflowName);

  // For manual runs, get ALL unconsolidated actions (no age filter)
  const store = readActionStore(workflowName);
  const unconsolidated = store.actions.filter((a) => !a.consolidated);

  if (unconsolidated.length === 0) {
    info("No unconsolidated actions to process.");
    return;
  }

  info(`Found ${unconsolidated.length} unconsolidated actions across ${groupIntoSessions(unconsolidated).length} session(s).`);

  const spin = spinner("Consolidating memory...");
  try {
    // For manual consolidation, temporarily override the age filter
    // by marking all unconsolidated actions' dates as old enough
    await runConsolidationNoAgeFilter(workflowName, wf);
    spin.stop();

    // Show results summary
    const facts = readFactStore(workflowName);
    const obs = readObservationStore(workflowName);
    success(`Consolidation complete!`);
    info(`Facts: ${facts.facts.length} total`);
    info(`Observations: ${obs.observations.length} recent, ${obs.summaries.length} summaries`);
  } catch (e: unknown) {
    spin.stop();
    const msg = e instanceof Error ? e.message : String(e);
    logError(`Consolidation failed: ${msg}`);
  }
}

/** Internal: run consolidation without the 12h age filter (for manual CLI invocation) */
async function runConsolidationNoAgeFilter(
  workflowName: string,
  workflow: WorkflowConfig,
): Promise<void> {
  const store = readActionStore(workflowName);
  const unconsolidated = store.actions.filter((a) => !a.consolidated);
  if (unconsolidated.length === 0) return;

  // Group into sessions
  const sessions = groupIntoSessions(unconsolidated);
  if (sessions.length === 0) return;

  // Build prompt
  const existingFacts = getTopFacts(20, workflowName)
    .map((f) => `[${f.id}] [${f.category}/${f.confidence}] ${f.content}`)
    .join("\n");

  const prompt = buildConsolidationPrompt(sessions, workflow, existingFacts);

  // Call Claude
  const env = readEnv();
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured.");

  const client = createAnthropicClient(apiKey);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = response.content[0].type === "text" ? response.content[0].text : "";

  let result: ConsolidationResult;
  try {
    result = JSON.parse(responseText.trim());
  } catch (e: unknown) {
    getLogger().child({ component: "twitter", workflow: workflowName })
      .warn({ err: e, responseText: responseText.slice(0, 200) }, "Consolidation parse failed (manual)");
    throw new Error("Failed to parse consolidation response from Claude.");
  }

  // Apply updates
  for (const obs of result.observations ?? []) {
    const session = sessions[0];
    addObservation({
      date: session[0].date,
      sessionId: sessionId(session),
      content: obs.content,
      priority: obs.priority ?? 5,
      metrics: obs.metrics,
    }, workflowName);
  }

  if (result.factUpdates?.length) {
    applyFactUpdates(result.factUpdates, workflowName);
  }

  if (result.relationshipUpdates?.length) {
    applyRelationshipUpdates(result.relationshipUpdates, workflowName);
  }

  // Mark consolidated
  const latestDate = unconsolidated
    .map((a) => a.date)
    .sort()
    .pop() ?? new Date().toISOString();
  markConsolidated(latestDate, workflowName);

  // Reflect if needed
  if (needsReflection(workflowName)) {
    await runReflection(workflowName);
  }
}
