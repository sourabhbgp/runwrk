# Project Structure

```
src/
├── index.ts                  # CLI entry point & command router
├── common/                   # Shared utilities (no feature imports)
│   ├── ui.ts                 # Terminal formatting (bold, dim, spinner, etc.)
│   ├── env.ts                # .env.local read/write helpers
│   └── index.ts              # Barrel exports
└── modules/
    └── auth/                 # LLM authentication module
        ├── anthropic.ts      # Client factory (OAuth + API key support)
        ├── setup.ts          # Interactive setup command
        └── index.ts          # Public API: { createAnthropicClient, isOAuthToken, setup }
```

# Architecture Rules

- **Feature modules** live in `src/modules/<name>/`, each with an `index.ts` barrel exporting its public API.
- **`common/`** holds shared utilities. It must NEVER import from `src/modules/`.
- **Modules import `common/`**, never each other. Shared logic between modules belongs in `common/`.
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
