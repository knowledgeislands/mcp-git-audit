# Guides

Practical instructions for `mcp-git-audit` — an MCP server that reports branch, working-tree, and upstream state across a tree of local git repositories, and can optionally perform git mutations. Guides answer **how**: what someone does, in what order, and how they know it worked. The reasoning behind the design lives in [the decision records](../decisions/README.md), and planned work in [the roadmap](../roadmap/).

## Contents

Guides are grouped by the job of the person reading them.

- [User guides](user/README.md) — for anyone pointing this server at their own repositories through an MCP client: installing it, choosing which directories it may read, running an audit, deciding whether to let it write, and getting unstuck.
- [Developer guides](developer/README.md) — for anyone changing the code: how the layers fit together, the invariants every change has to preserve, and the local loop and gates.

There is no separate operator audience, and that is deliberate. This server is a stdio process the client launches on demand: no account, no daemon, no credential to rotate, no state between calls beyond an optional audit log. The person who decides which directories it may reach is the same person who then asks it a question, so those decisions live in the user guides that need them rather than in an operator tier nobody would be reading.

## Before you point it at anything

Two things are worth knowing before the first run.

The server can only ever reach inside `MCP_GIT_AUDIT_SAFE_ROOTS`. Every path argument — including a path handed back from an earlier result — is re-validated against that allow-list, after `~` expansion and symlink resolution, before any `git` runs. Left unset, the allow-list defaults to your entire home directory, which is broad; [Installing the server](user/installing-the-server.md) covers narrowing it.

The server is read-only until you say otherwise. `MCP_GIT_AUDIT_ACCESS_LEVEL` defaults to `read`, and the tools that change anything are not registered at all at that level — a client cannot call what was never advertised. [Granting write access](user/granting-write-access.md) covers what changes when you raise it, and why that is a different safeguard from the `dry_run` flag.

## Where the answers live

| Question                              | Where it is answered                                          |
| ------------------------------------- | ------------------------------------------------------------- |
| What is this and what can it do?      | [The README](../../README.md)                                 |
| What exactly does each tool accept?   | The running server, via your MCP client's tool listing†        |
| How do I do a given piece of work?    | These guides                                                  |
| Why is it built this way?             | [Decision records](../decisions/README.md)                    |
| What is planned or in flight?         | [The roadmap](../roadmap/)                                    |

† Each tool's parameters, defaults, and descriptions are published by the server itself and rendered live by the client. This repository deliberately keeps no second, hand-maintained copy of them, because a transcribed schema drifts from the code that serves it.
