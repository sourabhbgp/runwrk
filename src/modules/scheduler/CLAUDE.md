# Scheduler Module Documentation

## Overview

Generic OS-level job scheduler — runs any `myteam` CLI command on a cron schedule using native OS timers (launchd on macOS, systemd on Linux). No persistent process needed; missed runs are recovered automatically by both platforms.

## Module Structure

- `types.ts` — `ScheduledJob`, `JobStatus`, `Platform`, `ExecutablePaths` interfaces
- `jobs.ts` — Registry CRUD on `.myteam/scheduler/jobs.json` (add, remove, update, list, get)
- `platform.ts` — Platform detection (`darwin`/`linux`) and delegation to the correct backend
- `launchd.ts` — macOS backend: plist generation, `cronToCalendarIntervals`, launchctl install/uninstall/status
- `systemd.ts` — Linux backend: service/timer file generation, `cronToOnCalendar`, systemctl install/uninstall/status
- `logs.ts` — Read/clear/tail log files from scheduled runs
- `index.ts` — Public API barrel

## Storage Layout

```
.myteam/
└── scheduler/
    ├── jobs.json                   ← registry of all scheduled jobs
    └── logs/
        ├── <name>.stdout.log       ← stdout from scheduled runs
        └── <name>.stderr.log       ← stderr from scheduled runs
```

## Platform Backends

### macOS (launchd)

- **Plist path**: `~/Library/LaunchAgents/com.myteam.<name>.plist`
- **Install**: writes plist, runs `launchctl bootstrap gui/<uid> <path>`
- **Uninstall**: runs `launchctl bootout gui/<uid>/com.myteam.<name>`, deletes plist
- **Cron conversion**: `cronToCalendarIntervals()` converts 5-field cron to launchd `StartCalendarInterval` dicts (cartesian product for multi-value fields)

### Linux (systemd)

- **Unit paths**: `~/.config/systemd/user/myteam-<name>.service` and `.timer`
- **Install**: writes both files, runs `systemctl --user daemon-reload && enable --now`
- **Uninstall**: stops, disables, deletes files, daemon-reloads
- **Cron conversion**: `cronToOnCalendar()` converts 5-field cron to systemd `OnCalendar` syntax
- **Missed-run recovery**: `Persistent=true` in timer files

## Key Concepts

- **Generic**: The scheduler has no module-specific logic — it runs any CLI command string. Today it schedules Twitter jobs; tomorrow it can schedule anything.
- **Enable/disable**: Jobs can be paused (`enabled: false`) without removing them from the registry. Disabling uninstalls the OS timer; enabling reinstalls it.
- **No validation of commands**: The scheduler doesn't check if a command is valid. If the command fails at runtime, the error is captured in the log files.
- **Path resolution**: `resolveExecutablePaths()` uses `process.execPath` (bun binary) and resolves `src/index.ts` relative to `process.cwd()`. If the project moves, jobs need to be re-added.

## CLI Usage

```
myteam schedule add --name <n> --command <cmd> --cron <expr>   # Add and install a job
myteam schedule add --name <n> --command <cmd> --cron <expr> --timezone <tz> --description <desc>
myteam schedule remove <name>                                   # Uninstall and remove
myteam schedule list                                            # List all jobs with status
myteam schedule enable <name>                                   # Re-enable a paused job
myteam schedule disable <name>                                  # Pause without removing
myteam schedule logs <name>                                     # Show recent output
myteam schedule logs <name> --lines 100                         # Show more lines
myteam schedule logs <name> --clear                             # Truncate log files
```

## Cron Expression Support

Both backends support standard 5-field cron: `minute hour day month weekday`

- Specific numbers: `0 9 * * *` (daily at 9:00)
- Comma-separated lists: `0 9,14,20 * * *` (three times daily)
- Wildcards: `* * * * *` (every minute)
- **Not supported**: ranges (`1-5`), steps (`*/15`), or other advanced syntax
