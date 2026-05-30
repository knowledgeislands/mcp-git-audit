# Contributing

Thanks for your interest. This file covers the dev loop, conventions, and what to check before you open a PR.

## Setup

You'll need [Bun](https://bun.sh) 1.3+ for the dev loop, and Node.js 22+ to run the compiled `dist/` output the published package ships.

```bash
git clone https://github.com/knowledgeislands/mcp-git-audit.git
cd mcp-git-audit
bun install
```

`bun install` triggers `prepare` which configures the husky pre-commit hook — so every commit will auto-run `lint-staged` and format your changes.

## Dev loop

```bash
bun run server:mcp:dev      # bun --watch — runs the server from source
bun run server:mcp:inspect  # MCP Inspector against the TS source
bun run lint:types          # tsc --noEmit
bun run test                # vitest (use `bun run test`, not `bun test`)
bun run test:watch          # vitest in watch mode
bun run test:coverage       # vitest with v8 coverage report
bun run lint:check          # Biome lint + format check
bun run lint:fix            # Biome auto-fix
bun run lint:md             # prettier + markdownlint for *.md
```

## Conventions

### Code

- **TypeScript ES modules** — `"type": "module"`, internal imports use `.js` extensions (e.g. `from './scan.js'`) so `tsc` emits valid JS.
- **Layout**: config lives in `src/config/index.ts` (`loadConfig()` — no module-level env reads); the real implementation lives under `src/main/<area>/` and takes the `Config` slice it needs as its first argument; `src/tools/<area>/index.ts` holds thin tool defs; the stdio wrapper is `src/mcp-server/index.ts`. See CLAUDE.md → "Project layout & config injection".
- **Arrow functions** for top-level declarations (`export const foo = () => …`).
- **Strict path safety**: any tool argument that points at the filesystem must go through `resolveAgainstSafeRoots(...)` from `src/utils/paths.ts`, passing the configured `cfg.safeRoots`. Inputs that escape every configured safe root throw `not inside any configured safe_root`.
- **`git` invocations**: shell out via `execFile` (never `exec`) with a hard per-call timeout. Errors are caught per-repo and aggregated into the result's `errors[]` rather than failing the whole call.
- **Errors**: tools return MCP errors via `errorResult(...)`; structured results via `jsonResult(...)`.
- **Annotations**: be honest with `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` on every tool registration.

### Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) so version bumps are easy to derive when releasing by hand. There is no auto-release pipeline.

| Type        | What it means           | Bumps |
| ----------- | ----------------------- | ----- |
| `feat:`     | new feature             | minor |
| `fix:`      | bug fix                 | patch |
| `perf:`     | performance improvement | patch |
| `docs:`     | documentation only      | patch |
| `deps:`     | dependency change       | patch |
| `refactor:` | internal restructuring  | none  |
| `test:`     | test-only changes       | none  |
| `chore:`    | tooling, config         | none  |
| `build:`    | build pipeline          | none  |
| `ci:`       | CI changes              | none  |

Add `!` for breaking changes (`feat!:` / `fix!:`) — bumps major.

### Testing

- New code should ship with tests. Vitest is configured with V8 coverage and has thresholds in `vitest.config.ts` — if your change drops coverage below the threshold, CI fails.
- Test repos are created with real `git init` inside `os.tmpdir()`. Config is injected, not read from env: tests pass an explicit `safeRoots`/`Config`/`AuditConfig` value into the `main/` functions (no `process.env` mutation, no `vi.resetModules()` dance). The fixture safe root is a tmpdir, so tests should clean up after themselves with `beforeAll`/`afterAll`.

## Before opening a PR

- [ ] `bun run lint:check` passes
- [ ] `bun run lint:types` passes
- [ ] `bun run test:coverage` passes (no threshold failures)
- [ ] Commit messages follow Conventional Commits
- [ ] If you changed the `repo_audit` output shape, update `README.md`, `CLAUDE.md`, and the matching consumer artifact

CI runs all of the above on every PR.
