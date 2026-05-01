# MindSwap Local-First Roadmap

## Product Direction

MindSwap's primary goal is to preserve and share useful context between AI tools.

The product should optimize for:

- local ownership of memory
- open-source distribution
- cross-tool continuity
- zero required cloud services
- strong developer workflows first
- room for broader personal AI memory later

MindSwap is not a hosted SaaS in this roadmap. It is a local-first memory layer with repo memory and global personal memory.

## Core Model

MindSwap has two first-class memory scopes:

- `global personal memory`
  - personal preferences
  - reusable learnings
  - cross-tool facts
  - long-term context not tied to one repo
- `repo memory`
  - project state
  - task progress
  - decisions
  - blockers
  - repo-scoped conventions

Repo memory remains the strongest coding workflow wedge. Global memory becomes the persistent identity and cross-tool continuity layer.

## Storage Model

Human-readable files remain part of the product promise:

- `~/.mindswap/`
- `<repo>/.mindswap/`
- `HANDOFF.md`
- `AGENTS.md`
- `CODEX.md`
- other generated tool files

SQLite is used as a local intelligence layer, not a cloud dependency:

- no hosted database
- no user accounts
- no remote billing or auth
- no recurring infrastructure cost

## What MindSwap Should Not Build Right Now

Do not prioritize:

- Supabase or hosted Postgres
- user login/logout/whoami
- Stripe billing
- cloud sync
- hosted dashboard
- org workspaces backed by a server

These add product cost and complexity without strengthening the main continuity loop enough.

## Near-Term Product Roadmap

### Phase 1: Global Personal Memory

Ship first-class global memory for use outside repos and across tools.

Targets:

- global memory storage under `~/.mindswap/`
- CLI support for global memory CRUD
- scoped search across global, repo, or both
- scoped `ask` support
- personal preferences and reusable learnings as first-class memory types

### Phase 2: Local Search Engine

Add a local indexing layer to make recall fast and scalable.

Targets:

- local SQLite index
- reindex command
- ranking over global and repo memories
- related-memory lookup
- dedupe foundations

### Phase 3: Smarter Continuity

Targets:

- stronger `resume`
- better "what changed since last session"
- better unresolved item surfacing
- better conflict and drift analysis
- improved imported/native session normalization

### Phase 4: Shared Local Workflows

Targets:

- clearer solo vs shared memory boundaries
- better team attribution in committed memory
- git-friendly shared continuity workflows
- stronger cross-tool handoff prompts and exports

## User Promise

MindSwap should let users say:

- "My AI context stays on my machine."
- "I can carry memory across tools without a cloud account."
- "I can inspect my memory in plain files."
- "I can search both personal and project memory from one tool."

## Immediate Execution Priority

Build in this order:

1. global personal memory
2. scoped recall across global and repo memory
3. local indexing layer
4. smarter continuity features on top of those two scopes
