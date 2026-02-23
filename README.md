# myteam

A task-focused AI assistant CLI powered by Claude. Lightweight, streaming chat with persistent memory, configurable system prompts, and autonomous Twitter engagement.

## Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- An [Anthropic API key](https://console.anthropic.com/settings/keys)

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd myteam

# Install dependencies
bun install

# Link the CLI globally (makes `myteam` available everywhere)
bun link
```

After linking, the `myteam` command is available in your terminal. Alternatively, run commands directly with `bun run src/index.ts <command>`.

## Setup

Before using the chat, configure your Anthropic API key:

```bash
myteam setup
```

This will:
1. Prompt you for your Anthropic API key (`sk-ant-...`)
2. Verify the key works by making a test API call
3. Save the key to `.env.local` in the project directory

If you already have a key configured, setup will show a preview and let you keep or replace it.

## Usage

### Chat

Start an interactive chat session:

```bash
myteam chat
```

This launches a REPL where you type messages and get streaming responses from Claude. The assistant is task-focused — concise and direct, no unnecessary preamble.

### Slash Commands

Inside a chat session, these commands are available:

| Command | Description |
|---|---|
| `/new` | Clear the conversation and start fresh |
| `/remember <text>` | Save a fact to persistent memory |
| `/forget <text>` | Remove the first memory entry matching the text |
| `/memory` | List all saved memories |
| `/exit` | Exit the chat (or press Ctrl+D) |

### Memory

Memory lets you persist facts across chat sessions. Memories are stored in `.myteam/MEMORY.md` and automatically injected into the system prompt every time you start a chat.

```
> /remember always respond in bullet points
✓ Remembered: always respond in bullet points

> /memory
Saved memories:
  • always respond in bullet points

> /forget bullet points
✓ Forgot entry matching: bullet points
```

Memories survive across sessions — close the chat, reopen it, and Claude still knows what you told it to remember.

### Custom System Prompt

By default, the assistant uses a built-in system prompt:

> You are a focused task assistant. Be concise and direct. Help the user with their current task. Avoid unnecessary preamble.

To customize this, create a `.myteam/SYSTEM.md` file:

```bash
mkdir -p .myteam
cat > .myteam/SYSTEM.md << 'EOF'
You are a senior backend engineer. When answering questions:
- Always consider edge cases
- Suggest tests for any code you write
- Use TypeScript examples unless asked otherwise
EOF
```

The custom system prompt fully replaces the default. Persistent memories are still appended to whatever system prompt is active.

### Twitter Engagement

Run autonomous Twitter engagement powered by Claude:

```bash
myteam twitter
```

By default this runs in **auto mode** — the agent fetches your mentions, timeline, and discovery feeds, analyzes each tweet, crafts contextual replies, and posts them automatically.

To review each reply before it's posted, use **manual mode**:

```bash
myteam twitter --manual
```

In manual mode you approve, edit, or skip each suggested reply interactively.

#### Twitter Subcommands

| Command | Description |
|---|---|
| `myteam twitter setup` | Configure your Twitter credentials (rettiwt API key) and engagement preferences |
| `myteam twitter stats` | View engagement analytics — reply counts, response rates, and trends |
| `myteam twitter feedback` | Manage persistent directives that shape how the agent writes replies |

## Project Structure

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
    │   └── index.ts          # Public API
    ├── chat/                 # Task-focused chat module
    │   ├── chat.ts           # Main REPL loop with streaming
    │   ├── session.ts        # In-memory message history & system prompt
    │   ├── commands.ts       # Slash command parser & handlers
    │   ├── memory.ts         # Persistent memory (.myteam/MEMORY.md)
    │   └── index.ts          # Public API
    └── twitter/              # Twitter engagement module
        ├── api.ts            # Rettiwt wrapper — all Twitter operations
        ├── feed.ts           # Fetch & organize: mentions, timeline, discovery
        ├── agent.ts          # Claude integration — analyze tweets, craft replies
        ├── prompt.ts         # System prompt for the Twitter agent
        ├── session.ts        # Interactive approve/edit/skip loop
        ├── auto.ts           # Autonomous mode
        ├── config.ts         # Read/write .myteam/twitter-config.json
        ├── stats.ts          # Engagement analytics display
        ├── memory.ts         # Engagement history (.myteam/twitter-memory.json)
        ├── feedback.ts       # Persistent agent directives manager
        ├── setup.ts          # Credential setup (rettiwt API key)
        └── index.ts          # Public API

.myteam/                      # Runtime data (gitignored)
├── MEMORY.md                 # Persistent memories
├── SYSTEM.md                 # Custom system prompt (optional)
├── twitter-config.json       # Twitter engagement preferences
└── twitter-memory.json       # Engagement history
```

## All Commands

```
myteam setup                 Configure your Anthropic API key
myteam chat                  Start an interactive chat session
myteam twitter               Run autonomous Twitter engagement (default: auto)
myteam twitter --manual      Run interactive Twitter engagement
myteam twitter setup         Configure Twitter credentials and preferences
myteam twitter stats         View engagement analytics
myteam twitter feedback      Manage agent directives
myteam --help                Show help
myteam --version             Show version
```
