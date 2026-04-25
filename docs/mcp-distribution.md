# MCP Distribution Guide

This guide covers how to publish `mindswap` as an MCP server and keep the distribution metadata aligned with the npm package.

## What gets published

`mindswap` now ships with a committed `server.json` manifest at the repo root. That manifest is the registry-facing contract for the MCP server.

The current metadata flow is:

- `package.json` owns the package name, version, description, repository, and `mcpName`
- `server.json` mirrors the MCP Registry identity and package entry
- `npx mindswap registry` validates the two files together
- `npx mindswap registry --write` regenerates `server.json` from the package metadata

## How to validate before publishing

Run the registry check locally:

```bash
npx mindswap registry --json
```

Use the JSON output when you want to automate a release gate or wire the check into CI. The report should be `ready: true` before you publish.

If the manifest is missing or stale, regenerate it:

```bash
npx mindswap registry --write
```

If you want to verify a remote MCP endpoint is part of the manifest, pass a remote URL:

```bash
npx mindswap registry --write --remote-url https://example.com/mcp
```

## Release checklist

Before you publish a new release:

1. Confirm `package.json.version` and `server.json.version` match.
2. Confirm `package.json.mcpName` matches `server.json.name`.
3. Run `npx mindswap registry --json` and fix any issues.
4. Run `npm test`.
5. Publish the npm package.
6. Authenticate with `mcp-publisher login github`.
7. Publish the MCP Registry entry with `mcp-publisher publish`.

## Keeping metadata in sync

The repo expects the npm package and registry manifest to move together.

- If you bump the npm version, regenerate `server.json` before publish.
- If you change the package name or repository URL, regenerate `server.json`.
- If you add a remote MCP endpoint, re-run `npx mindswap registry --write --remote-url ...` so the manifest stays honest.

## What the registry command checks

`npx mindswap registry` reports whether:

- `package.json` has `mcpName`
- `server.json` exists
- the registry name matches the package metadata
- the package version matches the manifest version
- the npm package entry exists
- a remote transport entry exists when required

That keeps the publish step deterministic and prevents stale registry submissions.
