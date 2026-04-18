# relay-dev

**Your AI's black box recorder.**

Automatically tracks your project state so any AI coding tool can pick up exactly where the last one stopped.

Hit the token limit in Claude Code? Switch to Cursor — it reads your `.relay/HANDOFF.md` and knows everything: what you were building, what's done, what's broken, and what to do next.

```bash
npx relay-dev init
```

## The problem

You're mid-feature in Codex. Tokens run out. You switch to Claude Code. It has **zero context** — doesn't know your architecture, your decisions, or that you're halfway through implementing auth middleware with 3 files left to touch.

You spend 20 minutes re-explaining. Every. Single. Time.

## The solution

Relay lives in your project and maintains a **universal context file** that ANY AI tool can read:

```
.relay/
├── HANDOFF.md       ← The universal handoff doc. Any AI reads this.
├── state.json       ← Machine-readable project state
├── decisions.log    ← WHY you made each decision
├── config.json      ← Your preferences
└── history/         ← Checkpoint timeline
    ├── checkpoint-2026-04-18T10-30-00.json
    └── checkpoint-2026-04-18T11-45-00.json
```

It also generates **tool-specific files** so every AI reads context in its native format:

| AI Tool | Generated File | Behavior |
|---------|---------------|----------|
| Universal | `HANDOFF.md` | Full overwrite (relay-owned) |
| Claude Code | `CLAUDE.md` | Safe merge — preserves your existing content |
| Cursor | `.cursor/rules/relay-context.mdc` | Own file (no conflicts) |
| GitHub Copilot | `.github/copilot-instructions.md` | Safe merge |
| Codex / Others | `AGENTS.md` | Safe merge |

> **Safe merge**: If you already have a `CLAUDE.md` or `AGENTS.md`, relay appends its section inside `<!-- relay-dev:start -->` / `<!-- relay-dev:end -->` markers. Your content is never overwritten.

## Quick start

```bash
# 1. Install in your project
npm install relay-dev --save-dev

# 2. Initialize (auto-detects your stack)
npx relay init

# 3. Start working. Save checkpoints when switching AI tools:
npx relay checkpoint "auth middleware — JWT validation done, refresh tokens left"

# 4. Log important decisions (so the next AI doesn't redo them)
npx relay log "chose JWT over sessions — need stateless API for serverless deploy" --tag architecture

# 5. Generate context files for all AI tools
npx relay generate --all

# 6. Mark task complete when done
npx relay done "auth shipped"

# 7. Or run in watch mode — auto-updates as you code
npx relay watch
```

## Commands

### `relay init`
Sets up `.relay/` in your project. Auto-detects:
- Language (JS/TS, Python, Go, Rust, Ruby)
- Framework (Next.js, React, Vue, Express, Django, FastAPI, Rails, etc.)
- Package manager (npm, yarn, pnpm, bun, pip, cargo)
- Test runner, build tool, databases
- Installs a git post-commit hook for auto-checkpoints

### `relay checkpoint [message]`  (alias: `relay cp`)
Saves a snapshot of current state — git diff, changed files, branch, current task.
```bash
npx relay cp "implementing rate limiter — basic throttle done, Redis integration next"
npx relay cp --task "rate limiter" --blocker "Redis connection timeout" --next "debug Redis config"
```

### `relay log <message>`  (alias: `relay l`)
Logs a decision permanently. This is the **most valuable context for the next AI** — knowing WHY you chose something prevents it from suggesting alternatives you already rejected.
```bash
npx relay log "using Prisma over Drizzle — team knows it better" --tag database
npx relay log "NOT using Redis for sessions — overkill for our scale" --tag architecture
```

### `relay done [message]`  (alias: `relay d`)
Marks the current task as completed, archives it to history, and resets to idle.
```bash
npx relay done "auth feature shipped"
npx relay done  # no message, just mark done
```

### `relay reset`  (alias: `relay r`)
Clears the current task and checkpoint state. Decisions and history are preserved by default.
```bash
npx relay reset        # clear task, keep decisions
npx relay reset --full # clear task AND decisions
```

### `relay status`  (alias: `relay s`)
Shows current relay state at a glance.
```bash
npx relay status        # human-readable
npx relay status --json # for scripts
```

### `relay generate`  (alias: `relay gen`)
Generates AI context files from current state. **Safely merges** with existing files — your hand-written `CLAUDE.md` or `AGENTS.md` content is preserved.
```bash
npx relay gen              # HANDOFF.md only (default)
npx relay gen --all        # All supported formats
npx relay gen --claude     # CLAUDE.md only
npx relay gen --cursor     # .cursor/rules only
npx relay gen --copilot    # copilot-instructions.md only
npx relay gen --agents     # AGENTS.md only
```

### `relay watch`  (alias: `relay w`)
Watches your project for file changes (using [chokidar](https://github.com/paulmillr/chokidar)) and auto-updates `.relay/HANDOFF.md`.
```bash
npx relay watch              # default 2s debounce
npx relay watch -i 5000      # 5s debounce
```

## How it works

```
Developer working in Codex          Developer switches to Cursor
         │                                      │
         ▼                                      ▼
   relay monitors                     Cursor reads HANDOFF.md
   ┌─────────────┐                   ┌──────────────────────┐
   │ git changes  │                   │ "You were working on │
   │ file edits   │ ──► HANDOFF.md ──►│  auth middleware.     │
   │ build errors │     state.json    │  JWT done. Refresh   │
   │ decisions    │     CLAUDE.md     │  tokens left. Using  │
   │ checkpoints  │     AGENTS.md     │  Prisma + PostgreSQL │
   └─────────────┘     .cursorrules   │  Branch: feat/auth"  │
                                      └──────────────────────┘
```

## What gets tracked

| Signal | How | When |
|--------|-----|------|
| Git branch & diff | `simple-git` | Every checkpoint |
| Modified files | Git status | Every checkpoint + watch |
| Recent commits | Git log | Every checkpoint |
| Current task | Your checkpoint message | When you tell it |
| Decisions | `relay log` | When you log them |
| AI tool in use | File-based detection | Auto-detected |
| Tech stack | package.json + lockfiles | On init |

## What to commit

**Commit these** (they're the handoff context):
- `.relay/state.json`
- `.relay/decisions.log`
- `.relay/config.json`
- `HANDOFF.md`

**Don't commit** (auto-added to .gitignore):
- `.relay/history/` (local checkpoint timeline)

## FAQ

**Q: Does it work with [my AI tool]?**
A: If your AI tool can read markdown files in the project (which all of them do), yes. The tool-specific generators (CLAUDE.md, .cursorrules, etc.) are bonus.

**Q: Will it overwrite my existing CLAUDE.md?**
A: No. Relay uses `<!-- relay-dev:start -->` / `<!-- relay-dev:end -->` markers to inject its section. Your hand-written content is preserved.

**Q: Does it slow down my workflow?**
A: No. The only manual step is `npx relay cp` when you switch tools. The git hook handles auto-checkpoints on commit. Watch mode runs in the background using chokidar (event-based, not polling).

**Q: What if I forget to checkpoint?**
A: The git post-commit hook creates auto-checkpoints. Plus, `HANDOFF.md` always reflects the latest git state when regenerated.

**Q: How do I finish a task and start fresh?**
A: `npx relay done "task completed"` archives the current task and resets to idle. Use `npx relay reset` to clear without archiving.

## License

MIT
