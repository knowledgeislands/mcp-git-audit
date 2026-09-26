# Working on the code

Set up the repository, run the server from source, and get a change through every gate that CI will apply to it.

## Setup

You need [Bun](https://bun.sh) 1.4 for the development loop and Node.js 22 or later to run the built output, which is what an MCP client actually launches. [`mise.toml`](../../../mise.toml) pins both; `mise install` gets you the right versions if you use it.

```bash
git clone https://github.com/knowledgeislands/mcp-git-audit.git
cd mcp-git-audit
bun install
```

`bun install` runs `prepare`, which installs the husky hooks. From then on every commit runs `lint-staged` — Biome over TypeScript, JavaScript and JSON, rumdl over Markdown, both with fixes applied — plus a `syncpack` format check, and `commitlint` over the message.

## The loop

```bash
bun run ki:server:mcp:dev      # bun --watch, NODE_ENV=development, runs from source
bun run ki:server:mcp:inspect  # MCP Inspector against the source server
bun run test                   # vitest — use `bun run test`, never `bun test`
bun run test:watch             # vitest in watch mode
bun run test:coverage          # vitest with v8 coverage and its thresholds
bun run build                  # tsc → dist/
bun run ki:server:mcp:start    # build, then run dist/ under node
bun run ki:test:smoke          # build, then boot the built server and check its wire surface
```

`bun test` invokes Bun's own runner rather than vitest and will not apply this project's configuration; the distinction matters enough that it is worth building the habit.

The development scripts set `NODE_ENV=development`, which is the only condition under which the server reads `.env.*` files. Copy [`.env.example`](../../../.env.example) to `.env.development` and set `MCP_GIT_AUDIT_SAFE_ROOTS` to a scratch directory — pointing a development server at your real tree is unnecessary and makes test output harder to read.

The MCP Inspector is the fastest way to see what the client will see. It shows the registered tool list, which is how you confirm the access gate behaves: start it with the default configuration and five tools appear, start it with `MCP_GIT_AUDIT_ACCESS_LEVEL=destructive` and twelve do.

## Gates

Everything CI runs, you can run locally, and in the same order:

```bash
ki repo audit --repo .   # every declared KI skill: Biome, types, Markdown, repository contracts
bun run test
bun run test:coverage
bun run ki:test:smoke
```

`ki repo audit` is the linting, type-checking and documentation gate in one; `ki repo conform --repo .` applies the fixes it can make mechanically. Prefer running `conform` once after a batch of edits rather than between them.

Coverage thresholds are 100% on lines, functions, branches and statements, and they fail the build rather than warn. Two exclusions keep that honest rather than absurd: the stdio wrapper in `src/mcp-server/`, and the thin tool definitions in `src/tools/**/index.ts`. Both are wiring. If a change to a tool file needs a test to reach it, that is the signal that the logic belongs in `src/main/` instead — the exclusion is a design constraint, not an escape hatch.

`ki:test:smoke` builds `dist/` and boots the real server over stdio to check that its wire-level tool surface matches what the in-process registration tests expect. It catches the class of mistake unit tests structurally cannot: a tool registered in a test harness but not in the built binary.

> [!NOTE] The dev-loop list in `CONTRIBUTING.md` still names `bun run ki:lint:*` scripts. Those no longer exist; linting and type checking moved into `ki repo audit`. The commit and pull-request conventions in that file are current.

## Adding a tool

The layering in [Architecture](architecture.md) turns this into a fixed sequence.

Write the implementation in `src/main/<area>/`, taking `safeRoots` as the first argument if it touches the filesystem at all, and knowing nothing about MCP. Test it there — this is where the coverage gate applies and where the behaviour actually lives.

Then add the definition in `src/tools/<area>/index.ts`: a strict Zod schema using the shared identifier validators for anything that becomes an argv token, a call into `main/`, and `jsonResult` or `errorResult` to shape the envelope. Keep it free of branches.

Set `annotations` explicitly to one of the presets in `src/utils/annotations.ts`. This is not optional and not decorative: the access gate derives the tool's level from those hints, and an unannotated tool is treated as destructive. Choose the preset that honestly describes the effect — `DESTRUCTIVE_ONESHOT` when running twice would not reach the same end state.

If the tool mutates anything, give it `dry_run` defaulting to `true`, and pass git's native `--dry-run` through where one exists. If it accepts a path, or a previous result containing paths, re-validate every one of them against the full `safeRoots` set.

Then extend the smoke test's expected surface, and check whether the README's capability table needs a new row — that table is deliberately the only hand-maintained inventory of the tool surface, since each tool's parameters are published by the server itself.

## Testing notes

Fixtures create real repositories with `git init` inside `os.tmpdir()`, and configuration is injected rather than read from the environment: tests pass an explicit `safeRoots` or `Config` value into the `main/` functions, so there is no `process.env` mutation and no module-reset dance. Clean up in `afterAll`.

One trap is worth knowing in advance. A fixture that exercises code which itself writes a commit — `pullRepo`, `commitRepo` — must set repository-local git identity with `git config user.name` and `user.email` on the fixture. The test helper's `GIT_AUTHOR_*` and `GIT_COMMITTER_*` environment variables only cover the helper's own git calls; production code spawns `git` without them, so on a machine with no global identity, such as CI, the test fails with `empty ident name`. `makeRepoWithUpstream` and `cloneWorkingCopy` in `src/main/repo-sync/index.test.ts` both do this correctly — copy the pattern.

No test touches a real user directory. The fixture safe root is always a temporary directory.

## Before you open a pull request

`CONTRIBUTING.md` holds the repository contribution contract and the Conventional Commits table that commitlint enforces. The short version is complete here: the four gates above pass, the commit messages parse, and anything that changes a result shape is a change to a contract downstream consumers already read.
