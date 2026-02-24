# Twitter Module Documentation

## Workflow System

Workflows are **goal-driven engagement campaigns** with isolated memory, strategy prompts, feed filtering, and action biases. Each workflow runs independently while sharing global safety state.

### Storage Layout

```
.myteam/
├── twitter-config.json              ← global (API setup, default limits) — unchanged
├── twitter-global.json              ← shared safety state (blocked accounts, daily post counts)
└── workflows/                       ← per-workflow directories
    ├── default/                     ← auto-migrated from legacy flat data
    │   ├── workflow.json            ← WorkflowConfig (strategy, filters, limits, etc.)
    │   ├── actions.json            ← raw action log (every reply, like, skip, etc.)
    │   ├── facts.json              ← atomic knowledge extracted by LLM consolidation
    │   ├── observations.json       ← session summaries + compressed period summaries
    │   └── relationships.json      ← per-account CRM data (warmth, reciprocity, topics)
    └── <user-created>/
        ├── workflow.json
        ├── actions.json
        ├── facts.json
        ├── observations.json
        └── relationships.json
```

### Key Concepts

- **Isolation**: Each workflow has its own tiered memory — action log, facts, observations, and relationships never cross-contaminate.
- **Global safety**: Blocked accounts and daily post counts are shared across all workflows via `twitter-global.json`.
- **Templates**: Two built-in templates (`follower-growth`, `hashtag-niche`) plus `custom`. Factories in `workflow.templates.ts`.
- **Auto-migration**: `ensureMigrated()` in `workflow.migrate.ts` runs at the top of any workflow-aware command. Stage 1 moves legacy `twitter-memory.json` into `workflows/default/`. Stage 2 converts `memory.json` into `actions.json` + empty stores. Old files renamed to `.backup`.
- **Workflow-aware functions**: All memory, prompt, feed, and agent functions accept optional `workflowName?: string` and/or `workflow?: WorkflowConfig` parameters. Without them, they fall back to legacy behavior.

## Tiered Memory System

The memory system has four layers, each backed by a separate JSON file per workflow:

1. **Actions** (`actions.json`) — raw engagement log. Every reply, like, skip is appended as an atomic entry. Source of truth.
2. **Facts** (`facts.json`) — durable knowledge extracted by LLM consolidation (e.g. "Replies with questions get 3x engagement"). Managed via ADD/UPDATE/DELETE operations. Typically <50 per workflow.
3. **Observations** (`observations.json`) — session-level summaries from consolidation. When they grow large (~15K tokens), a reflection pass compresses older observations into period summaries.
4. **Relationships** (`relationships.json`) — per-account CRM. Tracks warmth (cold→warm→hot based on interaction count), reciprocity score, topics, and notes.

**Working Memory**: `memory.working.ts` assembles a bounded ~2-3K token block from all four stores for injection into the system prompt. This keeps prompt size constant regardless of how many sessions have run.

**Consolidation**: `memory.consolidate.ts` runs daily (24h interval, actions must be 12h old). Groups actions into sessions (30-min gap = new session), sends to Claude, applies resulting fact updates, observations, and relationship notes. Can be triggered manually via `myteam twitter consolidate -w <name>`.

**Facade**: `memory.ts` preserves all old export signatures (`logReply`, `hasRepliedTo`, `readMemory`, etc.) but delegates to the new storage modules. No callers (session.ts, auto.ts, feed.ts) needed changes.

### Key Memory Modules

- `memory.types.ts` — all type definitions for the tiered system
- `memory.actions.ts` — raw action CRUD (logAction, hasEngaged, getDailyStats)
- `memory.facts.ts` — fact store CRUD (add/update/delete, applyFactUpdates)
- `memory.observations.ts` — session observations + reflection compression
- `memory.relationships.ts` — account CRM (warmth tiers: cold→warm→hot)
- `memory.working.ts` — assembles ~2-3K token prompt block from all stores
- `memory.consolidate.ts` — daily LLM pipeline (actions → facts/observations/relationships)
- `memory.ts` — thin facade preserving all old export signatures

## CLI Usage

```
myteam twitter -w <name>              # Run workflow (auto mode)
myteam twitter -w <name> --manual     # Run workflow (interactive)
myteam twitter workflow create        # Interactive guided setup
myteam twitter workflow list          # List all workflows
myteam twitter workflow edit -w <n>   # Edit workflow config
myteam twitter workflow delete -w <n> # Delete workflow + history
myteam twitter stats                  # Summary across all workflows
myteam twitter stats -w <name>        # Detailed stats for one workflow
myteam twitter feedback -w <name>     # Manage per-workflow directives
myteam twitter consolidate -w <name>  # Run memory consolidation manually
```

## Adding a New Workflow Template

1. Add a factory function in `workflow.templates.ts` (follow `createFollowerGrowthWorkflow` pattern).
2. Add the template key to the `WorkflowTemplate` union in `workflow.types.ts`.
3. Register it in the `TEMPLATES` map in `workflow.templates.ts`.
4. The interactive `workflowCreate()` picker will automatically include it.
