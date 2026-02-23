# Project Structure

```
src/
├── index.ts                  # CLI entry point (runs the Commander program)
├── cli/                      # Command registration (Commander.js)
│   ├── index.ts              # Builds the program, imports all register.*.ts files
│   ├── register.setup.ts     # `myteam setup` command
│   ├── register.chat.ts      # `myteam chat` command
│   └── register.twitter.ts   # `myteam twitter` + subcommands (setup, stats, feedback)
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
        ├── feed.ts           # Fetch & organize: mentions, timeline, discovery
        ├── agent.ts          # Claude integration — analyze tweets, craft replies
        ├── prompt.ts         # System prompt for the Twitter agent
        ├── session.ts        # Interactive approve/edit/skip loop
        ├── auto.ts           # Autonomous mode (--auto flag)
        ├── config.ts         # Read/write .myteam/twitter-config.json
        ├── stats.ts          # Engagement analytics display
        ├── memory.ts         # Engagement history (.myteam/twitter-memory.json)
        ├── feedback.ts       # Persistent agent directives manager
        ├── setup.ts          # Credential setup (rettiwt API key)
        └── index.ts          # Public API: { twitter, twitterSetup, twitterStats, twitterFeedback }
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

# Code Comments

- Always use proper comments to increase readability.
- Add a brief comment above every function explaining what it does and why.
- Use inline comments for non-obvious logic, edge cases, and "why" explanations — not for restating what the code already says.
- Add section headers (e.g. `// --- Feed Fetching ---`) to break up long files into logical blocks.
- Keep comments concise — one line where possible, a short block for complex logic.
