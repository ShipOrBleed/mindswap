# Local-First Memory Design

## Goal

Refocus MindSwap around its primary job: carrying context between AI tools using local memory, not hosted infrastructure.

## Product Boundary

MindSwap is a local-first AI memory layer with two scopes:

- global personal memory under `~/.mindswap/`
- repo memory under `<repo>/.mindswap/`

The global scope stores user-level continuity such as preferences and reusable learnings. The repo scope stores project-specific context such as tasks, blockers, decisions, and generated handoff state.

## Why This Shape

The current codebase is already strong at repo continuity:

- generated context files
- repo state and task tracking
- memory CRUD
- MCP context/search/prompts
- doctor and resume flows

What it lacks is a first-class memory layer that persists across repos and tools for the same person. Adding a global scope extends the current strengths without forcing a rewrite into a cloud product.

## Storage Design

Human-readable files remain important:

- users can inspect them
- users can back them up easily
- repo data stays git-friendly

Design rules:

- repo-generated context stays repo-scoped
- personal memory is not blindly injected into every repo handoff
- search and MCP can read both scopes and rank them together
- commands that mutate memory must know which scope they are writing to

## First Implementation Slice

The first shipped slice should avoid rewriting the entire architecture.

Ship:

- global memory store under `~/.mindswap/memory.json`
- CLI flags to target `global`, `repo`, or `all`
- scoped `log`
- scoped `memory` CRUD
- scoped `ask`
- helper functions that resolve the correct memory root

Do not ship in this slice:

- full global state/checkpoint lifecycle
- global handoff generation
- SQLite index
- migrations of all repo commands to dual-scope behavior

## Command Behavior

### `log`

- default behavior inside repos stays repo-scoped
- `--global` writes to global memory

### `memory`

- supports repo scope by default inside repos
- supports `--global`
- supports `--scope repo|global|all`
- `all` is valid for reads, not writes

### `ask`

- inside repos, default stays repo-focused
- `--global` searches global memory only
- `--scope all` searches global memory and repo memory together

## Search Rules

When searching both scopes:

- repo task/blocker/decision context should still outrank unrelated personal memory
- global preferences and reusable learnings should appear when they are semantically relevant
- output should surface the scope of each result

## Testing Strategy

Use TDD.

Add tests for:

- global memory file path resolution
- logging global memory outside repos
- listing global memory
- asking global memory
- combined search result scope labels

## Risks

- leaking personal memory into repo-specific workflows too aggressively
- making write commands ambiguous when outside repos
- overloading the current `searchContext` path with too much new scope logic at once

## Initial Mitigation

- keep writes explicit with `--global` or `--scope`
- keep repo defaults unchanged where possible
- add shared helper functions rather than spreading scope branching across every command
