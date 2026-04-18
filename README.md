# mindswap

[![npm version](https://img.shields.io/npm/v/mindswap.svg)](https://www.npmjs.com/package/mindswap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Your AI's black box recorder.**

One command captures your entire project state. Switch between Claude Code, Cursor, Copilot, Codex — the next AI picks up instantly. Zero re-explaining.

```bash
npm install mindswap --save-dev
npx mindswap init
```

## The problem

You're mid-feature in Codex. Tokens run out. You switch to Claude Code. It has **zero context** — doesn't know your architecture, your decisions, or that you're halfway through implementing auth middleware.

You spend 20 minutes re-explaining. Every. Single. Time.

## The solution

Just run `mindswap`. That's it.

```bash
$ npx mindswap

⚡ Saving project state...

  Task:      user auth (auto-detected from branch)
  Branch:    feat/user-auth
  Changed:   4 files
  Tests:     ✓ 12 passed, 0 failed
  Decisions: 2 auto-logged from deps

✓ State saved — ready to switch tools
```

It auto-detects your task from the branch name, captures git state, logs dependency changes as decisions, and generates context files for **every AI tool**:

| AI Tool | Generated File | Behavior |
|---------|---------------|----------|
| Universal | `HANDOFF.md` | Full overwrite (mindswap-owned) |
| Claude Code | `CLAUDE.md` | Safe merge — your content preserved |
| Cursor | `.cursor/rules/mindswap-context.mdc` | Own file (no conflicts) |
| GitHub Copilot | `.github/copilot-instructions.md` | Safe merge |
| Codex / Others | `AGENTS.md` | Safe merge |

## The entire flow

```bash
npx mindswap init     # once per project
npx mindswap          # when switching tools
npx mindswap done     # when feature is complete
```

Everything else is automatic — git hooks track commits, dependencies are auto-logged, branch state is auto-managed.

## 10 commands

| Command | Alias | What it does |
|---------|-------|-------------|
| `mindswap` | `save` | **THE one command.** Auto-detects task, deps, state — generates all context files |
| `mindswap init` | — | Initialize. Auto-detects 30+ frameworks, imports existing AI context files |
| `mindswap switch <tool>` | `sw` | One-command tool switch — save + generate + open (cursor/claude/copilot/codex/windsurf) |
| `mindswap done [msg]` | `d` | Mark task complete, archive to history, reset to idle |
| `mindswap log <msg>` | `l` | Log a decision. Warns if it conflicts with existing decisions |
| `mindswap status` | `s` | Current state — task, branch, build/test, conflicts. `--stats` for charts |
| `mindswap summary` | `sum` | Full session narrative — task, commits, decisions, conflicts. `--json` for scripts |
| `mindswap gen --all` | `gen` | Generate context files for all AI tools. Safe merge — never overwrites |
| `mindswap watch` | `w` | Background watcher — auto-updates HANDOFF.md on file changes |
| `mindswap reset` | `r` | Clear task state. Decisions preserved. `--full` to clear everything |

## Key features

### Auto-everything
- **Task detection** — from branch name (`feat/user-auth` → "user auth") + recent commits
- **Dependency tracking** — added Stripe? Auto-logged. Removed Redis? Logged too.
- **Git hooks** — auto-saves state on every commit

### Branch-aware state
Each git branch has its own state. Switch to `feat/payments` — it loads that branch's task and decisions. Switch back to `main` — your main state is restored.

### Decision conflict detection
Log "NOT using Redis" then later "using Redis"? mindswap warns you. Also catches reversed choices and package.json contradictions.

### Safe merge
Already have a CLAUDE.md? mindswap appends its section inside `<!-- mindswap:start/end -->` markers. Your content is never touched.

### Build/test tracking
```bash
npx mindswap --check   # runs tests, captures results
# Tests: ✓ 47 passed, 0 failed
```
The next AI knows "tests were passing" or exactly what's broken.

### 30+ frameworks detected
Next.js, Remix, Astro, SolidJS, Angular, NestJS, Express, Fastify, Hono, Django, FastAPI, Flask, Gin, Echo, GoFr, Fiber, Actix, Axum, Rails, Spring Boot, and more. Plus databases, monorepo tools, CI/CD, and infrastructure.

## What lives in `.mindswap/`

```
.mindswap/
├── HANDOFF.md       ← any AI reads this
├── state.json       ← machine-readable state
├── decisions.log    ← WHY you made each decision
├── config.json      ← your preferences
├── branches/        ← per-branch state (auto)
└── history/         ← checkpoint timeline
```

**Commit these** (handoff context): `state.json`, `decisions.log`, `config.json`, `HANDOFF.md`

**Don't commit** (auto-added to .gitignore): `history/`, `branches/`

## FAQ

**Will it overwrite my existing CLAUDE.md?**
No. Uses `<!-- mindswap:start/end -->` markers. Your content is preserved.

**Does it work with my AI tool?**
If it reads markdown files (all of them do), yes.

**Does it slow things down?**
No. Only runs when you call it. Git hook runs silently on commit.

**Multiple branches?**
State is auto per-branch. Switch branches, state switches too.

**What languages?**
JS/TS, Python, Go, Rust, Ruby, Java/Kotlin. Auto-detects from project files.

## License

MIT
