# Project Structure

```
src/
├── index.ts                  # CLI entry point (runs the Commander program)
├── cli/                      # Command registration (Commander.js)
│   ├── index.ts              # Builds the program, imports all register.*.ts files
│   ├── register.setup.ts     # `myteam setup` command
│   ├── register.chat.ts      # `myteam chat` command
│   └── register.twitter.ts   # `myteam twitter` + subcommands (setup, stats, feedback, workflow, consolidate)
├── common/                   # Shared utilities (no feature imports)
│   ├── ui.ts                 # Terminal formatting (bold, dim, spinner, etc.)
│   ├── env.ts                # .env.local read/write helpers
│   ├── timeout.ts            # withTimeout helper & TimeoutError
│   └── index.ts              # Barrel exports
└── modules/
    ├── auth/                 # LLM authentication module
    │   ├── anthropic.ts      # Client factory (OAuth + API key support)
    │   ├── setup.ts          # Interactive setup command
    │   └── index.ts          # Public API: { createAnthropicClient, isOAuthToken, setup }
    ├── chat/                 # Task-focused chat module
    │   ├── chat.ts           # Main chat entrypoint
    │   ├── session.ts        # Chat session management
    │   ├── commands.ts       # Chat slash-command handling
    │   ├── memory.ts         # Chat conversation memory
    │   └── index.ts          # Public API: { chat }
    └── twitter/              # Twitter engagement module
        ├── api.ts            # Rettiwt wrapper — all Twitter operations
        ├── feed.ts           # Fetch & organize: mentions, timeline, discovery (workflow-aware)
        ├── agent.ts          # Claude integration — analyze tweets, craft replies (workflow-aware)
        ├── prompt.ts         # System prompt builder (injects workflow strategy + working memory)
        ├── session.ts        # Interactive approve/edit/skip loop (requires workflow)
        ├── auto.ts           # Autonomous mode (workflow-aware)
        ├── config.ts         # Read/write .myteam/twitter-config.json + mergedLimits helper
        ├── stats.ts          # Engagement analytics (per-workflow or cross-workflow summary)
        ├── memory.ts         # Public API facade — thin wrappers delegating to tiered storage modules
        ├── memory.types.ts   # Type definitions for the tiered memory system
        ├── memory.actions.ts # Raw action log CRUD (logAction, hasEngaged, getDailyStats)
        ├── memory.facts.ts   # Atomic knowledge store (add/update/delete facts from consolidation)
        ├── memory.observations.ts # Session summaries + reflection compression
        ├── memory.relationships.ts # Per-account CRM (warmth tiers, reciprocity, topics)
        ├── memory.working.ts # Working memory assembler (~2-3K token prompt block)
        ├── memory.consolidate.ts # Daily LLM extraction pipeline (actions → facts/observations/relationships)
        ├── feedback.ts       # Persistent agent directives (per-workflow)
        ├── setup.ts          # Credential setup (rettiwt API key)
        ├── workflow.types.ts  # Shared types: WorkflowConfig, GlobalSafetyState, FeedFilters, etc.
        ├── workflow.ts        # Workflow CRUD + global safety state persistence + path helpers
        ├── workflow.templates.ts # Template factories: follower-growth, hashtag-niche, custom
        ├── workflow.migrate.ts   # Two-stage migration: legacy flat → workflows, memory.json → actions.json
        ├── workflow.commands.ts  # Interactive create/list/edit/delete commands
        └── index.ts          # Public API: { twitter, twitterSetup, twitterStats, twitterFeedback, workflowCreate, workflowList, workflowEdit, workflowDelete, runManualConsolidation }
```

# Architecture Rules

- **Feature modules** live in `src/modules/<name>/`, each with an `index.ts` barrel exporting its public API.
- **`common/`** holds shared utilities. It must NEVER import from `src/modules/`.
- **Modules import `common/`**, never each other (except `auth`, which other modules may import). Shared logic between modules belongs in `common/`.
- **Import from barrels only** — external code uses `../auth`, not `../auth/anthropic`.
- **`src/index.ts`** is the CLI entry point. It only builds and runs the Commander program from `src/cli/`.
- **`src/cli/`** manages all CLI commands via Commander.js. Each command lives in its own `register.*.ts` file and is wired up in `src/cli/index.ts`.
- **DRY** — before writing new code, check `common/` and existing modules for reusable logic. Extract repeated patterns into `common/` rather than duplicating across modules.

# Twitter Workflow System

Workflows are **goal-driven engagement campaigns** with isolated memory, strategy prompts, feed filtering, and action biases. Each workflow runs independently while sharing global safety state.

## Storage Layout

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

## Key Concepts

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

1. Add a factory function in `src/modules/twitter/workflow.templates.ts` (follow `createFollowerGrowthWorkflow` pattern).
2. Add the template key to the `WorkflowTemplate` union in `workflow.types.ts`.
3. Register it in the `TEMPLATES` map in `workflow.templates.ts`.
4. The interactive `workflowCreate()` picker will automatically include it.

# Adding a New Module

1. Create `src/modules/<name>/` with implementation files and an `index.ts` barrel.
2. Import shared utils from `../../common`.
3. If the module depends on auth, import from `../auth`.
4. Register CLI commands by creating a `src/cli/register.<name>.ts` file and calling it from `src/cli/index.ts`.

# CLI Changes (Commander.js)

All CLI commands, subcommands, flags, and descriptions are managed via Commander.js in `src/cli/`. **Any** CLI-related change must be reflected there:

- **Adding a new command** → create `src/cli/register.<name>.ts`, import and call it in `src/cli/index.ts`.
- **Adding a new subcommand** → add it inside the relevant `register.*.ts` file.
- **Adding or changing a flag/option** → update the `.option()` call in the relevant `register.*.ts` file.
- **Renaming or removing a command** → update or delete the corresponding `register.*.ts` file and remove its import from `src/cli/index.ts`.
- **Never hardcode help text** — Commander auto-generates `--help` at every level from the registered commands and descriptions.
- Command actions should use **dynamic imports** (`await import("../modules/...")`) to keep startup fast.

# Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **LLM SDK**: @anthropic-ai/sdk
- **Twitter**: rettiwt-api (cookie-based, no official API needed)
- **CLI**: Commander.js (command routing, flags, auto-generated help)

# TypeScript Safety

- Always follow strict TypeScript safety — use proper types, avoid `any` where possible, prefer explicit return types on public functions.
- Use `unknown` over `any` for untyped external data, then narrow with type guards.
- Never use `@ts-ignore` or `@ts-expect-error` — fix the type issue instead.
- Prefer `interface` for object shapes and `type` for unions/intersections.
- All new code must be type-safe — no implicit `any`, no untyped catch clauses without narrowing.

# Code Comments

- Always use proper comments to increase readability.
- Add a brief comment above every function explaining what it does and why.
- Use inline comments for non-obvious logic, edge cases, and "why" explanations — not for restating what the code already says.
- Add section headers (e.g. `// --- Feed Fetching ---`) to break up long files into logical blocks.
- Keep comments concise — one line where possible, a short block for complex logic.
