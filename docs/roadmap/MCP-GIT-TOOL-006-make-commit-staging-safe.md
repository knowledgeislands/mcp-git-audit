---
id: MCP-GIT-TOOL-006
title: Make commit staging safe
area: TOOL
theme: tool-surface
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-19T11:40:44Z
updated_at: 2026-10-04T18:26:33Z
---

## Goal

Make `git_repo_commit` safe for working trees shared by humans and agent threads without silently staging unrelated changes.

## Context

The tool currently defaults `stage` to `all_tracked`, implements that as `git add -u`, and also offers `all` through `git add -A`. Its default-true dry run still performs that staging mutation before calling `git commit --dry-run`. The portable `ki-git` policy now treats every working tree as potentially shared, tracks touched paths at file granularity, and forbids whole-tree staging because it can absorb another actor's work.

## Boundary

`git_repo_commit` only: its core in `src/main/repo-commit/commit.ts`, its MCP schema and description, the generated client projections, and the write-access guide. Explicit preview, path validation and access gating are preserved. No change to `git_repo_diff`, `git_repo_push` or any other tool, and no amend, history rewrite or broad staging mode in any form. No package release.

## Current state

At `f9becb8`, `git_repo_commit` defaults to `all_tracked` (`git add -u`), exposes `all` (`git add -A`), `paths` and `none`, and runs the staging step against the real index before `git commit [--dry-run]`, so a preview mutates the index and a default commit absorbs every tracked change in a shared tree. `validateRelPaths` rejects `..`, leading `-` or `/` and NUL/newline, but not pathspec magic or directories. `src/generated/types.d.ts` and `docs/guides/user/granting-write-access.md` describe the broad modes and the real-index preview. A search of the Knowledge Islands workspaces and the chezmoi source found no external caller of `git_repo_commit`.

## Steps

- [ ] Inventory the current commit schema, staged-index behaviour, generated client surface, and compatibility expectations.
- [ ] Replace the `stage` enum with `paths` (default) and `prepared_index`, both requiring a non-empty `paths`; remove `all_tracked`, `all` and `none` without aliases, so a stale caller fails validation loudly.
- [ ] Validate every path before any Git write: literal, repo-relative, no `..`, no leading `-` or `/`, no `:`, `*`, `?` or `[`, not a directory, and either present in the working tree or tracked at `HEAD`. Report every failure in `rejected_paths` and perform nothing.
- [ ] Build the commit in a temporary `GIT_INDEX_FILE` under the repository's Git directory, removed in `finally`: for `paths`, seeded from `HEAD` and given only the named paths; for `prepared_index`, a copy of the real index after confirming its staged set equals `paths` exactly. Preview never changes the real index. A real commit then updates the real index for exactly the committed paths to their committed content, so unrelated staged entries are preserved.
- [ ] Serialise calls per repository, refuse if `HEAD` moved during preparation, and after a real commit compare the committed path set with the approved set and the parent with the prepared `HEAD`; on mismatch return `ok: false` with the SHA and `hook_modified_paths`, never reset or amend.
- [ ] Return `ok`, `error`, `staged_paths`, `skipped_paths` (named but unchanged) and `rejected_paths` alongside the existing fields.
- [ ] Add shared-tree, pre-staged-change, dry-run, path-error, prepared-index, hook-addition, failed-hook and temporary-index-cleanup tests across the core and MCP tool boundaries.
- [ ] Record the contract in a Decision Record, update the tool description and the write-access guide, and regenerate client projections through `bun run ki:generate:client`.

## Files touched

`src/main/repo-commit/commit.ts` and its test, `src/tools/repo-commit/index.ts`, a tool-boundary test, `src/utils/git-exec.ts` (an optional environment override), `src/generated/client.ts` and `src/generated/types.d.ts` through their generation command, `docs/guides/user/granting-write-access.md`, a new `docs/decisions/ADR-MCP-GIT-001-*` and `docs/decisions/README.md`.

## Verify

A dry run leaves the real index byte-identical. A commit with unrelated staged and unstaged changes in the tree contains only the named paths, and those unrelated entries survive unchanged. A broad or legacy `stage` value fails schema validation. A hook that adds a path yields `ok: false` with that path and the SHA, and the commit is not rewritten. No temporary index survives any call. Run the focused repo-commit suites, then `bun run test`, `bun run test:coverage`, `bunx tsc --noEmit`, `bun run build`, `bunx biome check .`, `bunx knip`, and the declared repository audits.

## Dependencies / blocks

No build-order blocker. The compatibility decision and prepared-index rule are recorded under Owner compatibility decision below. Removing enum values is a breaking change to the public tool schema; any release that carries it is a semver-major decision for the owner and is not part of this item.

## Owner compatibility decision

Decided by the Fable reviewer under delegated autonomy (2026-10-04), reversible. Option (a), a breaking change: remove `all_tracked` and `all`; the `stage` enum becomes `paths` (the default; `paths` required and non-empty) and `prepared_index` (replacing `none`; `paths` required and must equal the currently staged path set exactly, otherwise the call refuses and lists the extra and missing paths). `none` is not aliased, so a stale client fails loudly. Preview and commit both run against a temporary `GIT_INDEX_FILE` in the repository's Git directory, removed in `finally`. Paths are literal, repo-relative files; `..`, a leading `-` or `/`, pathspec magic (`:`, `*`, `?`, `[`) and directories are rejected. Calls are serialised per repository and every call revalidates; a preview grants no later authority. After a commit, the committed path set is compared with `paths`; on mismatch the result is `ok: false` with `hook_modified_paths` and the SHA, and the tool never resets or amends. The response adds `staged_paths`, `skipped_paths` and `rejected_paths`. Write a Decision Record, regenerate `src/generated/*` through the owning command, and update `docs/guides/user/granting-write-access.md`.

Reasoning: no external caller exists (a search of the Knowledge Islands workspaces and the chezmoi source finds only this repository's own documentation, generated client and smoke list), the `ki-git` policy already forbids whole-tree staging, and keeping the broad modes behind an opt-in would preserve exactly the hazard this item removes. Removing enum values narrows write authority. The Git-level effect of the surviving `paths` mode is unchanged, a temporary index holds no durable state, and an owner decision to re-add a broad mode later is additive.

Implementation reading, for review: a temporary index that copies the real index would, in `paths` mode, commit whatever another actor had already staged. In `paths` mode the temporary index is therefore seeded from `HEAD`, and only `prepared_index` copies the real index. "Real index bytes never change" holds for every preview and every refusal; after a real commit the real index entries for exactly the committed paths are set to their committed content, as `git commit --only` does, because leaving them at their pre-commit content would record the reverse of the commit as staged.

## Documentation impact

### Decision Records

Record a Decision Record only if compatibility requires retaining a broad staging capability or selecting a durable index-isolation architecture with consequences beyond this tool.

### Specifications

Update the accepted MCP tool contract to make explicit paths, index side effects, preview guarantees, and compatibility behaviour testable.

### Guides

Update operator and integration guidance for safe path selection and any migration from the existing staging modes.

### Roadmap

No additional roadmap record is expected unless client migration or generated-projection work proves independently deliverable.

## Concrete design proposal

Prefer explicit literal repository-relative file paths, reject pathspec magic and directory expansion, and remove broad staging from the safe default. Preview should use a temporary index and leave real-index bytes unchanged. Prepared-index commits need an explicit complete intended path set rather than silently committing every staged change. Serialise real Git writes, revalidate HEAD, selected content and index state before commit, and preserve unrelated staged entries on success and failure. A preview alone grants no later commit authority.

Compatibility is unresolved: the public schema, generated clients and operator guide currently expose all_tracked, all, paths and none, and explicitly describe preview staging as a real index mutation. Decide rejection versus an exceptional migration route for legacy broad modes, and how existing prepared-index callers migrate. Default changes alone do not discharge this decision.

## Hook and failure decisions

Define how hooks may modify the index and selected files. Post-hook verification must compare the exact resulting committed path set with the approved set. Detection after HEAD advances cannot truthfully promise that no unintended commit occurred; choose prevention/isolation or an explicitly reviewed recovery guarantee. Do not autonomously rewrite shared history to hide a hook-added path. Cover changed HEAD/index between preview and commit, concurrent edits, hook additions, temporary-index cleanup, failed hooks and unrelated pre-staged bytes. Fixture commits require repository-local Git identity, as AGENTS.md specifies.

## Source-confirmed evidence

At reviewed source commit `7bf24cb582162fc8f17c6704754f94010c0b2176`, `src/main/repo-commit/commit.ts` executes staging before the dry-run commit, and `src/tools/repo-commit/index.ts` defaults to all_tracked. The generated type declaration preserves the broad modes. `docs/guides/user/granting-write-access.md` documents the real-index preview effect and broad-default risk. This is a public compatibility change, not an internal cleanup.

## Discussion

### Shared-tree safety

A safe design should make explicit path selection the normal commit boundary and ensure preview does not leave an unrequested index mutation. It should decide whether broad staging modes are removed, isolated behind an exceptional opt-in, or represented by a different operation whose side effects are unmistakable.

### Compatibility

Changing the default or removing enum values affects the public MCP input schema and generated client. Planning should examine whether a staged-index-only mode remains useful and how callers migrate without preserving the unsafe default.

### Readiness review

Source confirms dry-run calls git add against the real index and default all_tracked absorbs unrelated work. Required next design: default explicit literal file paths; no broad modes; isolated preview index; a defined prepared-index mode that names the complete intended set; preservation of unrelated staged bytes; serialization and revalidation before commit; post-hook verification of exact committed paths. Reject pathspec magic/directory expansion and test hook additions, stale preview, concurrent changes, staged unrelated files and failure cleanup. An implementation plan remains unsafe until these choices and compatibility migration are concrete.
