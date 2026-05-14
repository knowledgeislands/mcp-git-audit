# mcp-git-audit

[![CI](https://github.com/knowledgeislands/mcp-git-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-git-audit/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-git-audit.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-git-audit) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that walks a tree of git repositories
and returns branch, working-tree status, ahead/behind, and last-commit metadata
for each. Every walked path is validated against a configurable allow-list of
safe roots, so the server cannot reach into directories outside that allow-list
— even if asked to.

The work is split across two tools — `scan` (cheap filesystem walk) and `audit`
(per-repo `git` checks) — so a single scan can be cached and re-audited many
times without paying the walk cost again.

## Features

- **Read-only by default** — both tools are flagged read-only and idempotent via MCP tool annotations.
- **Split scan/audit pipeline** — `scan` does only the filesystem walk; `audit` consumes a scan result and runs the `git` calls. Cache the scan output and re-audit on demand.
- **Path safety in two layers** — `~` expansion plus realpath normalisation, applied to every safe root, every `root` argument, and every `abs_path` re-supplied to `audit`. A cached scan cannot widen the security boundary.
- **Per-call timeouts** — every `git` invocation is bounded (8s). One slow or broken repo can't stall the audit.
- **Error isolation** — per-repo failures (e.g. a corrupt `.git/HEAD`) are aggregated into the result's `errors[]` rather than failing the whole call.
- **No network, no auth** — pure local filesystem + `git`, over MCP stdio.

## Available Tools

| Tool | Description |
| --- | --- |
| `scan` | Walk a directory tree for `.git` directories and return repo metadata. No `git` calls. Cheap and cache-friendly. |
| `audit` | Run per-repo `git` checks (branch, working-tree status, ahead/behind, last commit) over a prior scan result. |

### `scan`

```json
{
  "name": "scan",
  "arguments": { "root": "~/dev", "max_depth": 2 }
}
```

#### Input

| Name | Type | Default | Notes |
| ---- | ---- | ------- | ----- |
| `root` | string | — | Optional when exactly one entry is configured in `MCP_GIT_AUDIT_SAFE_ROOTS`. Otherwise required, and must equal or live inside one of those entries. |
| `max_depth` | number | 2 | Max depth (from `root`) at which a repo directory may live. |

#### Output

```ts
{
  root: string;                // resolved absolute root
  scanned_at: string;          // ISO-8601 UTC
  repos: Array<{
    path: string;              // relative to root, forward slashes
    abs_path: string;          // absolute path on disk
    group: string;             // first path segment, or "(root)" for repos directly in root
    name: string;              // last path segment
  }>;
}
```

### `audit`

```json
{
  "name": "audit",
  "arguments": {
    "scan": { "root": "/Users/me/dev", "scanned_at": "2026-05-14T...", "repos": [/* ... */] }
  }
}
```

#### Input

| Name | Type | Default | Notes |
| ---- | ---- | ------- | ----- |
| `scan` | object | — | A previous result from the `scan` tool. Every `abs_path` is revalidated against `MCP_GIT_AUDIT_SAFE_ROOTS` before any `git` call. |
| `include_stale_days` | number | 30 | Reserved — currently unused; the consumer computes stale itself. |

#### Output

```ts
{
  root: string;                // resolved absolute root (pulled from the scan)
  scanned_at: string;          // ISO-8601 UTC — when the scan ran
  audited_at: string;          // ISO-8601 UTC — when this audit ran
  repos: Array<{
    path: string;              // relative to root, forward slashes
    group: string;
    name: string;
    branch: string;            // branch name, or "detached@<short-sha>" when detached
    detached: boolean;
    sha: string;               // short SHA of HEAD
    subject: string;           // last commit subject
    rel_date: string;          // e.g. "3 hours ago"
    iso_date: string;          // ISO-8601 committer date
    modified: number;
    untracked: number;
    has_remote: boolean;
    has_upstream: boolean;
    ahead: number;
    behind: number;
  }>;
  errors?: Array<{ path: string; message: string }>;
}
```

Errors:

- `root "<X>" is not inside any configured safe_root (...)` — the supplied `root` (or any `abs_path` in `scan.repos`) escapes every entry in `MCP_GIT_AUDIT_SAFE_ROOTS`.
- `root must be an absolute path or start with ~/: "<X>"` — relative paths are rejected.
- `root is required when multiple safe_roots are configured (...)` — only omittable when exactly one safe root is configured.

## Configuration

| Env var | Required | Notes |
| ------- | -------- | ----- |
| `MCP_GIT_AUDIT_SAFE_ROOTS` | no | Colon-separated list of absolute or `~/...` paths the tool is allowed to walk. May list several. Defaults to `~` (the user's home directory) when unset or empty. |

Any `root` argument (and every `abs_path` re-supplied to `audit`) must equal or
live inside one of the safe roots after `~` expansion and `realpath`-style
normalisation; otherwise the call returns an error. When only one safe root is
configured, `root` may be omitted on the `scan` call.

## Claude Desktop config

```json
{
  "mcpServers": {
    "mcp-git-audit": {
      "command": "node",
      "args": ["/path/to/mcp-git-audit/dist/mcp-server/index.js"],
      "env": {
        "MCP_GIT_AUDIT_SAFE_ROOTS": "~/dev"
      }
    }
  }
}
```

A copyable version of this is in [`claude-config-sample.json`](./claude-config-sample.json).

## Development

```bash
npm install                       # install deps
npm run dev:mcp                   # run from TS source, tsx watch mode
npm run inspect                   # MCP Inspector against the dev server
npm run test                      # vitest
npm run test:coverage             # vitest + v8 coverage
npm run typecheck                 # tsc --noEmit
npm run lint:check                # Biome lint + format check
npm run lint:fix                  # Biome auto-fix
npm run lint:md                   # prettier + markdownlint for *.md
npm run build                     # emit dist/
npm run start:mcp                 # build + run from dist/
```

## License

MIT — see [LICENSE](./LICENSE).
