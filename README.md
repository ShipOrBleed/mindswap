# mindswap

**Your AI's black box recorder.**

Automatically tracks your project state so any AI coding tool can pick up exactly where the last one stopped.

Hit the token limit in Claude Code? Switch to Cursor — it reads your `HANDOFF.md` and knows everything: what you were building, what's done, what's broken, and what to do next.

```bash
npx mindswap init
```

## The problem

You're mid-feature in Codex. Tokens run out. You switch to Claude Code. It has **zero context** — doesn't know your architecture, your decisions, or that you're halfway through implementing auth middleware with 3 files left to touch.

You spend 20 minutes re-explaining. Every. Single. Time.

## The solution

mindswap lives in your project and maintains a **universal context file** that ANY AI tool can read:

```
.mindswap/
├── HANDOFF.md       ← The universal handoff doc. Any AI reads this.
├── state.json       ← Machine-readable project state (branch-aware)
├── decisions.log    ← WHY you made each decision
├── config.json      ← Your preferences
├── branches/        ← Per-branch state (auto-managed)
└── history/         ← Checkpoint timeline
```

It generates **tool-specific context files** with safe merge — your existing `CLAUDE.md` is never overwritten:

| AI Tool | Generated File | Behavior |
|---------|---------------|----------|
| Universal | `HANDOFF.md` | Full overwrite (mindswap-owned) |
| Claude Code | `CLAUDE.md` | Safe merge via `<!-- mindswap:start/end -->` |
| Cursor | `.cursor/rules/mindswap-context.mdc` | Own file (no conflicts) |
| GitHub Copilot | `.github/copilot-instructions.md` | Safe merge |
| Codex / Others | `AGENTS.md` | Safe merge |

## Quick start

```bash
# Install and initialize
npm install mindswap --save-dev
npx mindswap init

# Save checkpoints when switching AI tools
npx mindswap cp "auth middleware — JWT done, refresh tokens left"

# Log decisions (most valuable context for the next AI)
npx mindswap log "chose JWT over sessions — stateless for serverless" --tag auth

# Switch to another AI tool in one command
npx mindswap switch cursor

# See everything at a glance
npx mindswap summary --stats
```

## 10 Commands

### `mindswap init`
Sets up `.mindswap/` in your project. Auto-detects language, framework, package manager, test runner, databases. **Imports existing AI context** — if you already have a `CLAUDE.md` or `.cursorrules` with decisions, mindswap pulls them into its decisions log.

### `mindswap checkpoint [message]` — alias: `cp`
Saves a snapshot — git diff, changed files, branch, current task, build/test status.
```bash
npx mindswap cp "rate limiter — basic throttle done, Redis next"
npx mindswap cp --task "rate limiter" --blocker "Redis timeout" --next "fix config"
npx mindswap cp --check          # also runs tests and captures results
npx mindswap cp --check --build  # run both tests and build
```

### `mindswap log <message>` — alias: `l`
Logs a decision permanently. **Warns if it conflicts** with an existing decision — e.g., if you log "using Redis" but a previous decision says "NOT using Redis".
```bash
npx mindswap log "using Prisma over Drizzle — team knows it" --tag database
npx mindswap log "NOT using Redis — overkill for our scale" --tag architecture
```

### `mindswap status` — alias: `s`
Shows current state — task, branch, build/test results, decision conflicts, and optional stats.
```bash
npx mindswap status           # human-readable
npx mindswap status --json    # for scripts
npx mindswap status --stats   # include session statistics + tool usage chart
```

### `mindswap generate` — alias: `gen`
Generates AI context files. **Safe merge** — your hand-written content is preserved via `<!-- mindswap:start/end -->` markers.
```bash
npx mindswap gen              # HANDOFF.md only (default)
npx mindswap gen --all        # All formats
npx mindswap gen --claude     # CLAUDE.md
npx mindswap gen --cursor     # .cursor/rules
npx mindswap gen --copilot    # copilot-instructions.md
npx mindswap gen --agents     # AGENTS.md
```

### `mindswap done [message]` — alias: `d`
Marks the current task as completed, archives it to history, resets to idle.
```bash
npx mindswap done "auth shipped"
```

### `mindswap reset` — alias: `r`
Clears current task and checkpoint state. Decisions and history preserved by default.
```bash
npx mindswap reset         # clear task, keep decisions
npx mindswap reset --full  # clear task AND decisions
```

### `mindswap watch` — alias: `w`
Watches your project (via chokidar) and auto-updates `HANDOFF.md` as files change.
```bash
npx mindswap watch            # 2s debounce
npx mindswap watch -i 5000    # 5s debounce
```

### `mindswap switch <tool>` — alias: `sw`
**One-command AI tool switch.** Checkpoints your state, generates the right context files, and opens the tool.
```bash
npx mindswap switch cursor     # checkpoint + .cursor/rules + open Cursor
npx mindswap switch claude     # checkpoint + CLAUDE.md
npx mindswap switch copilot    # checkpoint + copilot-instructions.md + open VS Code
npx mindswap switch codex      # checkpoint + AGENTS.md
npx mindswap switch windsurf   # checkpoint + cursor rules + open Windsurf
```

### `mindswap summary` — alias: `sum`
Full session narrative — current task, recent commits, uncommitted work, decisions, conflicts, and stats.
```bash
npx mindswap summary           # human-readable narrative
npx mindswap summary --stats   # include tool usage charts
npx mindswap summary --json    # machine-readable
```

## Key features

### Branch-aware state
mindswap automatically tracks state per git branch. Switch to `feat/payments` and it loads that branch's task, decisions, and checkpoint. Switch back to `main` and your main branch state is restored.

### Decision conflict detection
When you log a decision, mindswap scans for contradictions:
- "NOT using X" vs "using X"
- "chose X over Y" then later "using Y"
- Decisions that contradict your `package.json` dependencies

Conflicts are shown in `status`, `summary`, and warned when you `log`.

### Build/test tracking
Checkpoint with `--check` to run your tests and capture pass/fail:
```bash
npx mindswap cp "refactored auth" --check
# ⚡ Checkpoint saved
#   Tests:    ✓ 47 passed, 0 failed
```
The next AI sees "tests were passing when I left" — or knows exactly what's broken.

### Context import on init
If you already have a `CLAUDE.md`, `.cursorrules`, or `AGENTS.md` with decisions and conventions, `mindswap init` automatically extracts and imports them into the decisions log.

## How it works

```
Developer in Codex                  Developer switches to Cursor
       │                                      │
       ▼                                      ▼
  mindswap monitors                  Cursor reads HANDOFF.md
  ┌──────────────┐                  ┌──────────────────────────┐
  │ git changes   │                  │ "You were building       │
  │ file edits    │ → HANDOFF.md  → │  payments. Stripe done.  │
  │ build/tests   │   state.json    │  Webhooks left. Using    │
  │ decisions     │   CLAUDE.md     │  Prisma + PostgreSQL.    │
  │ conflicts     │   AGENTS.md     │  Tests: 47 passing.      │
  └──────────────┘   .cursorrules   │  Branch: feat/payments"  │
                                    └──────────────────────────┘
```

## What to commit

**Commit these** (handoff context):
- `.mindswap/state.json`
- `.mindswap/decisions.log`
- `.mindswap/config.json`
- `HANDOFF.md`

**Don't commit** (auto-added to .gitignore):
- `.mindswap/history/`
- `.mindswap/branches/`

## FAQ

**Q: Will it overwrite my existing CLAUDE.md?**
No. mindswap uses `<!-- mindswap:start -->` / `<!-- mindswap:end -->` markers. Your content is preserved.

**Q: Does it work with [my AI tool]?**
If your AI tool can read markdown files (all of them do), yes.

**Q: Does it slow things down?**
No. Only manual commands (`cp`, `log`) or the background `watch` mode. The git hook runs silently on commit.

**Q: What about multiple branches?**
State is automatically per-branch. Switch branches and mindswap loads that branch's state.

## License

MIT
