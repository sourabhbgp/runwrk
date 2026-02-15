# Project Structure

```
src/
├── index.ts                  # CLI entry point & command router
├── common/                   # Shared utilities (no feature imports)
│   ├── ui.ts                 # Terminal formatting (bold, dim, spinner, etc.)
│   ├── env.ts                # .env.local read/write helpers
│   └── index.ts              # Barrel exports
└── modules/
    ├── auth/                 # LLM authentication module
    │   ├── anthropic.ts      # Client factory (OAuth + API key support)
    │   ├── setup.ts          # Interactive setup command
    │   └── index.ts          # Public API: { createAnthropicClient, isOAuthToken, setup }
    └── twitter/              # Twitter engagement module
        ├── api.ts            # Rettiwt wrapper — all Twitter operations
        ├── feed.ts           # Fetch & organize: mentions, timeline, discovery
        ├── agent.ts          # Claude integration — analyze tweets, craft replies
        ├── session.ts        # Interactive approve/edit/skip loop
        ├── auto.ts           # Autonomous mode (--auto flag)
        ├── config.ts         # Read/write .myteam/twitter-config.json
        ├── stats.ts          # Engagement analytics display
        ├── memory.ts         # Engagement history (.myteam/twitter-memory.json)
        ├── setup.ts          # Credential setup (rettiwt API key)
        └── index.ts          # Public API: { twitter, twitterSetup, twitterStats }
```

# Architecture Rules

- **Feature modules** live in `src/modules/<name>/`, each with an `index.ts` barrel exporting its public API.
- **`common/`** holds shared utilities. It must NEVER import from `src/modules/`.
- **Modules import `common/`**, never each other (except `auth`, which other modules may import). Shared logic between modules belongs in `common/`.
- **Import from barrels only** — external code uses `../auth`, not `../auth/anthropic`.
- **`src/index.ts`** is the CLI entry point. Register new commands here.
- **DRY** — before writing new code, check `common/` and existing modules for reusable logic. Extract repeated patterns into `common/` rather than duplicating across modules.

# Adding a New Module

1. Create `src/modules/<name>/` with implementation files and an `index.ts` barrel.
2. Import shared utils from `../../common`.
3. If the module depends on auth, import from `../auth`.
4. Register any CLI commands in `src/index.ts`.

# Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **LLM SDK**: @anthropic-ai/sdk
- **Twitter**: rettiwt-api (cookie-based, no official API needed)

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
