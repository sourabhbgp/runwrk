# Project Structure

```
src/
├── index.ts                  # CLI entry point (runs the Commander program)
├── cli/                      # Command registration (Commander.js)
│   ├── index.ts              # Builds the program, imports all register.*.ts files
│   ├── register.setup.ts     # `myteam setup` command
│   ├── register.chat.ts      # `myteam chat` command
│   ├── register.schedule.ts  # `myteam schedule` + subcommands (add, remove, list, enable, disable, logs)
│   ├── register.daemon.ts    # `myteam daemon` command (starts in-process scheduler for Docker)
│   └── register.twitter.ts   # `myteam twitter` + subcommands (setup, stats, feedback, workflow, consolidate)
├── common/                   # Shared utilities (no feature imports)
│   ├── ui.ts                 # Terminal formatting (bold, dim, spinner, warn, etc.)
│   ├── env.ts                # .env.local read/write helpers
│   ├── timeout.ts            # withTimeout helper & TimeoutError
│   ├── logger.ts             # Structured logging via pino (createAppLogger, getLogger)
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
    ├── scheduler/            # Generic job scheduler (9 files — see src/modules/scheduler/CLAUDE.md)
    │   └── index.ts          # Public API: { listJobs, getJob, addJob, removeJob, updateJob, installJob, uninstallJob, startDaemon, ... }
    └── twitter/              # Twitter engagement module (22 files — see src/modules/twitter/CLAUDE.md)
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

# Testing

- **Framework**: Vitest (`vitest.config.ts` at root). Run via `bun test` (all), `bun test:unit`, `bun test:integration`, `bun test:e2e`, `bun test:coverage`.
- **All new code must include tests.** Unit tests at minimum; integration tests for cross-module or filesystem behavior; e2e for CLI binary changes.

## Directory Structure

```
tests/
├── setup.ts                    # Global setup (silences console via vi.spyOn)
├── helpers/
│   ├── index.ts                # Barrel exports for all helpers
│   ├── fixtures.ts             # createTestWorkspace() — temp dirs with .myteam/ structure
│   ├── mock-data.ts            # Factory functions with partial overrides (createMockFeedItem, createMockWorkflowConfig, etc.)
│   ├── program-factory.ts      # createTestProgram() — Commander program with exitOverride + captured output
│   └── strip.ts                # stripAnsi() helper
├── unit/<module>/              # Pure logic tests — one test file per source file
├── integration/                # Cross-module or filesystem tests
│   ├── cli/                    # Commander command routing, flags, help output
│   └── twitter/                # Workflow lifecycle, memory lifecycle
└── e2e/                        # Full CLI binary tests (spawned via execSync)
```

## Conventions

- **Naming**: `<source-file>.test.ts` — mirrors the source file name (e.g. `memory.facts.ts` → `memory.facts.test.ts`).
- **File header**: JSDoc block explaining what the test file covers and how it works.
- **Section headers**: Use `// --- sectionName ---` comments to separate test groups within a file.
- **Isolation**: Use `createTestWorkspace()` in `beforeEach`/`afterEach` for any test touching the filesystem. It creates a temp dir with `.myteam/workflows/` and cleans up after.
- **Fake timers**: Use `vi.useFakeTimers()` + `vi.setSystemTime()` for time-dependent logic. Always `vi.useRealTimers()` in `afterEach`.
- **Factory functions**: Use `tests/helpers/mock-data.ts` factories with partial overrides — tests only specify fields they care about.
- **CLI integration tests**: Use `createTestProgram()` from `tests/helpers/program-factory.ts` — it returns a Commander program with `exitOverride()` and captured stdout/stderr.
- **E2E tests**: Spawn the actual CLI binary via `execSync("bun run src/index.ts ...")` and assert on exit codes + output.
- **Path aliases**: Use `@/modules/...` and `@/cli/...` (from tsconfig paths) instead of fragile relative imports.
- **Mocks**: Prefer `vi.spyOn` over `vi.fn` when the real module exists. Use `restoreMocks: true` (configured globally in vitest.config.ts).

# Code Comments

- Always use proper comments to increase readability.
- Add a brief comment above every function explaining what it does and why.
- Use inline comments for non-obvious logic, edge cases, and "why" explanations — not for restating what the code already says.
- Add section headers (e.g. `// --- Feed Fetching ---`) to break up long files into logical blocks.
- Keep comments concise — one line where possible, a short block for complex logic.

# CLAUDE.md Documentation Policy

This project uses **hierarchical CLAUDE.md files** — a root file for universal project info and nested files for module-specific details. Follow these rules when making changes:

## When to Update Root CLAUDE.md (this file)

- **Adding a new module** → add its entry to the Project Structure tree (directory + barrel exports + reference to nested CLAUDE.md).
- **Adding a new CLI command** → add the `register.*.ts` file to the structure tree.
- **Changing architecture rules, tech stack, testing conventions, or code standards** → these are universal and belong here.
- **Keep it concise** — root CLAUDE.md should stay under ~150 lines. If a section grows large, move the detail into a nested file and link to it.

## When to Create/Update a Nested CLAUDE.md (`src/modules/<name>/CLAUDE.md`)

- **Every module with 5+ files** must have its own `CLAUDE.md` explaining internal architecture, storage layout, key concepts, and CLI usage.
- **Module-specific patterns** (e.g. workflow system, tiered memory, cron conversion) belong in the nested file, not the root.
- **Adding files or changing behavior within a module** → update that module's CLAUDE.md, not the root (unless the public API barrel changes).
- Nested CLAUDE.md files are loaded **on-demand** — only when Claude reads files in that subtree. This saves context tokens in unrelated sessions.

## Existing Nested CLAUDE.md Files

- `src/modules/twitter/CLAUDE.md` — workflow system, tiered memory, CLI usage, templates
- `src/modules/chat/CLAUDE.md` — session management, slash commands, memory
- `src/modules/scheduler/CLAUDE.md` — OS-level scheduling, daemon backend, platform backends, cron conversion, CLI usage
