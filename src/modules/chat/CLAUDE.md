# Chat Module Documentation

## Overview

Task-focused chat module providing interactive conversation sessions with Claude. Supports slash commands, session management, and conversation memory.

## Module Structure

- `chat.ts` — Main chat entrypoint, orchestrates the interactive loop
- `session.ts` — Chat session management (create, resume, list sessions)
- `commands.ts` — Slash-command handling within chat (e.g. `/help`, `/clear`)
- `memory.ts` — Conversation memory persistence across sessions
- `index.ts` — Public API barrel: `{ chat }`

## Key Concepts

- **Sessions**: Each chat conversation is a session with its own history. Sessions can be resumed.
- **Slash commands**: In-chat commands prefixed with `/` for controlling the session (handled in `commands.ts`).
- **Conversation memory**: Chat history is persisted so context carries across interactions within a session.
