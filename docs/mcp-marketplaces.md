# MCP Marketplace Matrix

`mindswap` can be distributed through several discovery and publishing surfaces. The right target depends on whether you want public discovery, GitHub-native visibility, or private/internal deployment.

## Official MCP Registry

- Audience: users and tools that discover MCP servers through the official registry
- Required artifact: `server.json`
- Required identity: a stable `mcpName` namespace, currently `io.github.shiporbleed/mindswap`
- Notes: this is the primary public registry path and the one the new `mindswap registry` command prepares for

What to do:

- keep `server.json` checked in
- keep the npm package metadata and registry metadata aligned
- use `mcp-publisher login github` and `mcp-publisher publish` for the release step

## GitHub MCP Registry

- Audience: GitHub-first users and teams already working inside the GitHub ecosystem
- Required artifact: the same registry metadata and repository visibility as the official registry
- Notes: useful when the goal is GitHub discovery and trust anchored in the repo owner

What to do:

- keep the GitHub repository public if you want broad discovery
- make sure the registry metadata points back to the repository
- keep release notes and tags in sync with published npm versions

## PulseMCP

- Audience: broader MCP users browsing third-party discovery surfaces
- Required artifact: a public registry entry that can be indexed and linked
- Notes: useful for reach beyond GitHub-centric audiences

What to do:

- publish the official registry entry first
- use the public package and repo URLs as the source of truth
- keep the README and docs explicit so the listing is easy to evaluate

## Private or self-hosted registry

- Audience: internal teams, enterprise deployments, or private toolchains
- Required artifact: the same registry manifest shape, but hosted in a private environment
- Notes: best when you want control over auth, rollout, and visibility

What to do:

- host the registry where your organization can reach it
- use a remote MCP endpoint if you want hosted browser access
- keep the repo metadata and server metadata synchronized across releases

## Recommendation for mindswap

The lowest-friction sequence is:

1. Publish the npm package.
2. Validate `server.json` with `npx mindswap registry --json`.
3. Publish to the official MCP Registry.
4. Surface the same metadata in GitHub discovery and third-party aggregators.
5. Use a private registry only when you need access control or internal-only distribution.

That keeps the public release path simple while still leaving room for internal deployment later.
