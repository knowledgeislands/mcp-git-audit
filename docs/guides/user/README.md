# User guides

For anyone running this server against their own repositories through an MCP client — installing it, telling it which directories it may look at, asking it what the tree looks like, and deciding whether it may change anything.

Changing the server's code is a different job and lives in [the developer guides](../developer/README.md).

## Contents

- [Installing the server](installing-the-server.md) — installing from the published package or from source, wiring it into Claude Desktop, Claude Code, or mcporter, choosing safe roots, and confirming the connection works.
- [Auditing repositories](auditing-repositories.md) — the scan-then-audit pipeline, why a scan result is worth holding on to, and reading the history and diff of a single repository.
- [Granting write access](granting-write-access.md) — what each access level unlocks, why `dry_run` is a separate safeguard from visibility, how force-push is gated, and what the audit log records.
- [Troubleshooting](troubleshooting.md) — the failures this server actually produces, what each one means, and how to recover.

## What you own

You own three decisions, and the server honours all three without arguing.

**Which directories it may reach.** `MCP_GIT_AUDIT_SAFE_ROOTS` is the whole security boundary. Everything else in this server assumes that value was chosen deliberately.

**How much it may do.** `MCP_GIT_AUDIT_ACCESS_LEVEL` decides which tools exist in the session at all. A model cannot talk you into a tool that was never registered.

**Whether calls are recorded.** `MCP_GIT_AUDIT_AUDIT_LOG` writes a JSONL line per invocation. It defaults to recording mutations only, which on a default read-only install means it records nothing.

The server owns none of these at runtime: configuration is read once at startup and never re-read, so changing any of them means restarting the server through your client.
