# Security Policy

## Reporting a Vulnerability

If you find a security issue in `@knowledgeislands/mcp-git-audit`, **please do not file a public GitHub issue.** Instead, email the maintainer directly:

- **<kris@kris.me.uk>** — subject: `mcp-git-audit security`

Include:

- A description of the issue and the impact (e.g. "audit walked outside MCP_GIT_AUDIT_SAFE_ROOTS", "git invocation with attacker-controlled arguments").
- Steps to reproduce, ideally with a minimal proof-of-concept.
- The version of the package (`npm ls @knowledgeislands/mcp-git-audit`) and Node version.

You should expect an acknowledgement within 72 hours. We aim to triage, investigate, and ship a fix within 14 days for high-severity issues.

## Scope

`mcp-git-audit` is a stdio MCP server that walks a directory tree and shells out to `git` to gather per-repository status. It runs locally with the privileges of the user who launched it, and the security boundary is the configured `MCP_GIT_AUDIT_SAFE_ROOTS`.

In scope:

- Path containment in `src/utils/paths.ts` (`resolveAgainstSafeRoots`) — any `root`/`abs_path` argument that resolves outside every configured safe root (traversal, symlink escape, encoded separators, edge cases around trailing slashes). Every `main/` entry point receives `safeRoots` (from `cfg.safeRoots`) as its first argument.
- `git` invocation in `src/main/repo-audit/audit.ts`, `src/main/repo-audit/detail.ts`, and `src/utils/git-exec.ts` (`runGitCapture`) — verifying every `git` child process is scoped to a resolved repo path inside a safe root, and that no argument is shell-interpolated (`execFile` with an argv array, `--no-optional-locks`).
- Repo discovery in `src/main/repo-audit/scan.ts` (`findRepos`) — depth limiting, refusal to recurse into hidden directories or `node_modules`, skipping worktree-pointer `.git` files.
- Boot-time validation in `src/config/index.ts` (`loadConfig`) of `MCP_GIT_AUDIT_SAFE_ROOTS`.

Out of scope:

- Issues only reproducible against a forked or modified version.
- Vulnerabilities in upstream dependencies (please report those upstream; open an issue here only if `mcp-git-audit` exposes the flaw in a way that the upstream project does not).
- Issues that require local OS-level access already higher-privileged than the user running the MCP server (e.g. an attacker who can already write inside one of the safe roots or replace the binary).
- Misconfiguration of `MCP_GIT_AUDIT_SAFE_ROOTS` to a directory the user did not intend to expose.

## Supported Versions

Only the latest published `1.x` release receives security fixes. Older pre-release builds are not supported.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |
