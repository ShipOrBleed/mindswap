# mindswap issue drafts

## 1. Add `mindswap doctor` for setup and context health checks

**Title:** Add `mindswap doctor` command for setup, context quality, and continuity diagnostics

**Body:**

## Summary

Add a new `mindswap doctor` command that actively validates the current project setup and context quality instead of only reporting passive quality signals.

## Problem

`mindswap` already computes a context quality score and has several implicit expectations:

- `.mindswap` should be initialized
- git hooks may be installed
- generated context files may be stale
- decisions may conflict
- build/test info may be missing
- AI tool context files may be missing or out of sync

Today, the product can report some of these signals indirectly, but there is no single diagnostic command that tells the user what is wrong and how to fix it.

## Proposed solution

Add `mindswap doctor` with checks such as:

- `mindswap` initialized or not
- required files present in `.mindswap/`
- active branch state available
- generated files exist and are fresh relative to state/checkpoints
- git hook installed and healthy
- decision conflicts detected
- dependency vs decision conflicts detected
- test/build status missing or stale
- MCP install/config status for supported tools
- context quality breakdown with actionable fixes

## Output shape

- Human-readable mode by default
- `--json` mode for automation
- Exit code non-zero when serious issues are found

## Why this matters

This raises trust in the product and gives users a concrete way to debug why continuity is weak in a given repo.

## Likely implementation areas

- `src/narrative.js`
- `src/state.js`
- `src/conflicts.js`
- `src/generate.js`
- `bin/mindswap.js`
- new `src/doctor.js`

## Acceptance criteria

- `npx mindswap doctor` prints a grouped report of issues/warnings/ok checks
- `npx mindswap doctor --json` returns structured machine-readable results
- detects stale or missing generated context files
- detects missing hooks and weak context coverage
- covered by tests

## 2. Introduce structured memory beyond decisions.log

**Title:** Introduce structured memory model for blockers, assumptions, open questions, and resolutions

**Body:**

## Summary

Expand mindswap from an append-only decision log into a structured project memory system.

## Problem

Current memory is strong for checkpoint/history and basic decision logging, but several critical continuity signals are still semi-structured or implicit:

- blockers
- assumptions
- unresolved questions
- next steps
- resolved decisions
- abandoned approaches

These are the exact kinds of things a new AI session needs most, and today they are either buried in free text or not represented explicitly enough.

## Proposed solution

Add a structured memory schema, likely under `.mindswap/`, for categories like:

- `decisions`
- `blockers`
- `assumptions`
- `questions`
- `next_steps`
- `resolved_items`

This can either supplement or gradually replace `decisions.log`.

## UX ideas

- `mindswap log --type decision`
- `mindswap log --type blocker`
- `mindswap log --type assumption`
- automatic carry-forward of unresolved items into generated handoff context

## MCP impact

This should improve:

- `mindswap_get_context`
- `mindswap_save_context`
- `mindswap_search`

because these tools would be able to return clearer, more composable context.

## Why this matters

This is a core product upgrade, not just a data-model cleanup. It makes the continuity layer more trustworthy and more useful for real in-progress work.

## Acceptance criteria

- new structured memory format added under `.mindswap/`
- CLI supports writing and reading multiple memory types
- generated context surfaces unresolved blockers/questions distinctly
- MCP responses expose structured memory cleanly
- migration path exists for current `decisions.log`

## 3. Add `mindswap resume` for start-of-session briefing

**Title:** Add `mindswap resume` command to generate a start-of-session action briefing

**Body:**

## Summary

Add a dedicated `resume` command that tells the next AI or developer what to do first, not just what the current state is.

## Problem

`HANDOFF.md` and MCP context provide useful state, but there is a missing product layer between “raw state” and “actionable resumption”.

What users often need at session start:

- what changed since last meaningful checkpoint
- what remains incomplete
- what is likely broken
- which blockers are active
- what the first next step should be

## Proposed solution

Add `mindswap resume` that synthesizes:

- session recap
- changes since last checkpoint/commit
- unresolved blockers/questions
- likely next action
- optional “recommended first commands to run”

## Possible flags

- `--compact`
- `--json`
- `--since <checkpoint|commit|time>`

## Why this matters

This creates a much sharper “pick up where I left off” experience than static handoff text alone.

## Acceptance criteria

- `npx mindswap resume` prints a concise action-oriented briefing
- uses current task, history, changes, and test/build status
- clearly distinguishes state from recommendation
- available through MCP or easily reusable by MCP tools later

## 4. Expand dependency and change detection beyond Node.js

**Title:** Expand dependency/change detection to Python, Go, Rust, and Ruby ecosystems

**Body:**

## Summary

Generalize automatic dependency/change detection so `mindswap` works consistently across non-Node projects.

## Problem

Project detection already supports several ecosystems, but automatic dependency-change logging is still heavily centered around `package.json`.

That creates a mismatch:

- detection says we support multiple stacks
- continuity depth is much stronger in JS/TS repos than elsewhere

## Proposed solution

Add dependency/change detection support for:

- Python: `requirements.txt`, `pyproject.toml`, `Pipfile.lock`, `poetry.lock`
- Go: `go.mod`
- Rust: `Cargo.toml`, `Cargo.lock`
- Ruby: `Gemfile`, `Gemfile.lock`
- optionally Java/Kotlin later: `pom.xml`, `build.gradle`, `build.gradle.kts`

## Behavior

When packages/libraries are added or removed, auto-log notable shifts as memory/decisions just like current Node-oriented behavior.

## Why this matters

This is required if mindswap wants to be genuinely language-agnostic instead of primarily optimized for JS repos.

## Acceptance criteria

- dependency-change detection works in at least Python, Go, Rust, and Ruby repos
- notable packages map to meaningful technology labels
- no noisy false positives on unchanged repos
- tests added for each supported ecosystem

## 5. Improve native session parsing and normalization

**Title:** Improve session parsing with a normalized cross-tool session model

**Body:**

## Summary

Upgrade native session parsing from tool-specific shallow extraction into a normalized session understanding layer.

## Problem

Current session parsing/import is a good start, but has important limitations:

- latest-session bias
- weak project matching heuristics
- limited tool coverage
- mostly extracts messages and file edits
- does not consistently extract intent, failures, blockers, or unfinished work

## Proposed solution

Create a normalized session schema that can represent:

- session timestamp and tool
- files touched
- commands run
- decisions made
- failures encountered
- blockers discovered
- unfinished tasks
- summary of accomplished work

Then have each tool parser map into that schema.

## Initial scope

- improve Claude Code parser
- improve Codex parser
- make it easy to plug in Cursor / other tools later

## Why this matters

This would materially improve handoff quality without requiring more manual user input.

## Acceptance criteria

- normalized session model introduced
- parsers emit structured session output
- project matching is more reliable
- generated context can surface “last session findings” cleanly
- tests added for parser edge cases

## 6. Upgrade `mindswap_search` from keyword search to semantic memory retrieval

**Title:** Upgrade `mindswap_search` to support semantic retrieval over project memory and history

**Body:**

## Summary

Make `mindswap_search` meaningfully useful for AI agents by moving beyond simple keyword matching.

## Problem

Searching project continuity data is one of the highest-value MCP actions, but plain text matching will not scale well as memory/history grows.

Users and agents need answers to questions like:

- “why did we choose this auth approach?”
- “what happened last time we touched payments?”
- “what blockers were found during the last failing test run?”

These queries are often semantic, not exact string matches.

## Proposed solution

Upgrade search to retrieve across:

- structured memory
- decisions/history
- recent checkpoints
- commit messages
- changed files
- optionally PR context

Possible path:

- short term: ranked lexical retrieval with better indexing
- later: optional embeddings-based semantic retrieval

## Why this matters

This directly improves the MCP story and makes mindswap more than a file generator.

## Acceptance criteria

- improved search ranking over current memory/history
- supports filters by source/type/time
- surfaces short synthesized answers with citations/links back to source items
- works both in CLI and MCP

## 7. Add team/shared mode for multi-developer continuity

**Title:** Add team mode for shared project memory, author attribution, and collaborative handoff

**Body:**

## Summary

Extend mindswap from single-user session continuity to collaborative team continuity.

## Problem

The current model is strongest for one developer switching between AI tools on one machine. There is no first-class concept of:

- authorship
- shared team memory
- per-branch human handoff
- coordination between multiple contributors

## Proposed solution

Add an optional team mode with capabilities such as:

- author attribution on checkpoints and memory items
- shared handoff conventions suitable for committed project memory
- better branch handoff summaries for PRs/reviews
- distinction between local-only and team-shared context

## Design concerns

- avoid polluting local flows for solo users
- preserve simple default UX
- make committed/shared memory explicit

## Why this matters

This would make mindswap useful for teams, not just individual AI-tool users.

## Acceptance criteria

- author field supported in relevant state/history entries
- shared vs local memory boundaries are explicit
- generated handoff can include author-aware recent work
- docs explain solo vs team workflows

## 8. Deepen IDE / tool integration and auto-hooks

**Title:** Deepen IDE integration with automatic session start/end hooks for supported AI tools

**Body:**

## Summary

Move from passive file generation toward deeper tool integration using automatic hooks where possible.

## Problem

Today, mindswap’s UX still depends heavily on the user remembering to run commands like `mindswap`, `switch`, or `gen`. That is good for an MVP, but weak for sticky daily use.

## Proposed solution

Explore integration paths for supported tools so mindswap can:

- refresh context at session start
- save context at session end
- update handoff after meaningful changes
- register MCP automatically where supported

## Example areas

- better Claude/Cursor/Codex integration
- stronger MCP install/config flows
- optional auto-save hooks on branch switch / task completion / commit boundaries

## Why this matters

Reducing manual friction is one of the highest-leverage ways to increase retention and daily value.

## Acceptance criteria

- at least one deeper automatic workflow added for a supported tool
- hook/install state visible to the user
- fallback remains safe and explicit when automation is not available

