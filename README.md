# mindswap

[![npm version](https://img.shields.io/npm/v/mindswap.svg)](https://www.npmjs.com/package/mindswap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Keep project context in the repo so AI tools can continue work without re-explaining the same codebase.

## Why it exists

AI sessions reset too often. mindswap saves the current task, decisions, blockers, and handoff context so the next tool can pick up cleanly.

## Install

```bash
npm install mindswap --save-dev
```

## Quick start

```bash
npx mindswap init
npx mindswap
npx mindswap doctor
npx mindswap resume
npx mindswap ask "Why did we choose JWT?"
```

## What it gives you

- `init` to set up a repo and import existing AI context
- `save` to capture the current task, git state, and decisions
- `doctor` to check setup health and stale context
- `resume` to start with a clean briefing
- `ask` to search project memory with citations
- `memory` to manage blockers, assumptions, questions, and resolutions
- `sync` to share continuity state across machines
- `mcp` and `mcp-http` to expose the same context to AI clients

## MCP and AI tools

mindswap generates context for tools like Claude Code, Cursor, Copilot, Codex, Windsurf, Cline, Roo, Aider, Amp, Gemini CLI, and AGENTS.md-based workflows.

```bash
npx mindswap mcp-install
npx mindswap mcp-http
```

## Project state

The main repo data lives in `.mindswap/`:

```text
.mindswap/
├── HANDOFF.md
├── state.json
├── decisions.log
├── memory.json
├── config.json
├── branches/
└── history/
```

## npm package

- npm: https://www.npmjs.com/package/mindswap
- GitHub: https://github.com/ShipOrBleed/mindswap

## Use it

If mindswap helps your workflow, star the repo and keep improving the handoff loop.
