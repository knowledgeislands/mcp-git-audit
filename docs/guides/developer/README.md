# Developer guides

For anyone changing the code in this repository — adding a tool, tightening a validator, extending a result shape, or reviewing someone who did.

Running the server against your own repositories is a different job and lives in [the user guides](../user/README.md). Read [Auditing repositories](../user/auditing-repositories.md) first if you have never used the server: the code is much easier to reason about once you have watched it walk a tree.

## Contents

- [Architecture](architecture.md) — the layers, which way configuration flows, how the access gate is driven, and the safety invariants every change has to preserve.
- [Working on the code](working-on-the-code.md) — setup, the dev loop, the gates a change must clear, and how to add a tool without bypassing anything.

[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) holds the contribution contract — commit conventions and what CI expects — and is not restated here.

## What constrains every change

Three things bind any contribution to this repository, and none of them are stylistic.

**Every filesystem path is validated against the configured safe roots before anything touches the disk.** Not the path you were given, not a path derived from a previous result you trust — every path, every time, through `resolveAgainstSafeRoots` with the full `safeRoots` set. The check is lexical normalisation plus a realpath comparison of the deepest existing ancestor, so it catches both `..` traversal and symlink escape. A tool that accepts a prior result as input re-validates every path inside it, because a cached result is user input.

**`git` is invoked through an argv array with a bound, never a shell string.** `execFile`, never `exec`; `--no-optional-locks` always; an explicit timeout always. Any user-supplied token that becomes an argv element goes through the tightened schemas in `src/utils/git-exec.ts`, which reject a leading `-`, `..` sequences, and control characters. A bare `z.string().min(1)` on an identifier is not acceptable.

**Coverage thresholds are 100% on lines, functions, branches, and statements.** Not a target — a gate that fails the build. The exclusions are deliberate and narrow: the stdio wrapper and the thin `src/tools/**/index.ts` definition files. That second exclusion is why logic must never live in a tool file.

## Where the answers live

| Question                                  | Where it is answered                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| How is the code arranged, and why?        | [Architecture](architecture.md)                           |
| What do I run, and what must pass?        | [Working on the code](working-on-the-code.md)             |
| What are the commit and PR expectations?  | [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)             |
| How do I report a vulnerability?          | [`SECURITY.md`](../../../SECURITY.md)                     |
| What is planned or in flight?             | [The roadmap](../../roadmap/)                             |

This repository keeps no specification corpus, so the behaviour contract for the tool surface is the code and its tests. Treat a test that pins an output shape as the contract it is: downstream consumers read these results.
