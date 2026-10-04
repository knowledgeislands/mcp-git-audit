---
id: ADR-MCP-GIT-001
title: 'Commit named paths through an isolated index'
date: 2026-10-04
status: current
decision_type: architecture
decision_type_url: https://knowledgeislands.info/specifications/decision-records/adr
---

# ADR-MCP-GIT-001: Commit named paths through an isolated index

## Context

`git_repo_commit` writes history in working trees that people and agent threads share. Any staging mode that operates on the whole tree, or on the real index as found, can absorb another actor's staged, modified or untracked work, and a preview that stages against the real index leaves a mutation behind. The Knowledge Islands `ki-git` policy treats every working tree as potentially shared and forbids whole-tree staging. The tool's `stage` enum is part of the public MCP input schema and of the generated client, so narrowing it is a breaking change. No external caller of the tool exists in the Knowledge Islands workspaces or the chezmoi source.

## Decision

The Fable reviewer made this decision under delegated autonomy on 2026-10-04, and it is reversible.

`git_repo_commit` commits only an explicit, non-empty `paths` list. The `stage` enum is `paths` (the default) or `prepared_index`; `all_tracked`, `all` and `none` are removed without aliases, so a stale caller fails validation. Each path is a literal, normalised, repo-relative file: directories, pathspec magic (`:`, `*`, `?`, `[`), `..` segments, a leading `-` or `/` and NUL or newline characters are rejected, and each path is present in the working tree or tracked at `HEAD`. Every failure is reported in `rejected_paths` before any Git write, and nothing is done.

Preview and commit run against a temporary `GIT_INDEX_FILE` in the repository's Git directory, removed after every call. In `paths` mode that index is seeded from `HEAD` and receives only the named paths. In `prepared_index` mode it is a copy of the real index, used only when the staged path set equals `paths` exactly. A preview, a refusal or a failure leaves the real index unchanged; after a real commit, the real index entries for exactly the committed paths take their committed content, as `git commit --only` does, and every other entry is untouched.

Calls are serialised per repository within the server process, and every call revalidates; a preview grants no later authority. A call refuses if `HEAD` moves during preparation or a merge, cherry-pick or revert is in progress. Hooks run. After a real commit, the committed path set is compared with the prepared set and the new commit's parent with the prepared `HEAD`; on any mismatch the result is `ok: false` with the SHA and `hook_modified_paths`, and the tool never resets, amends or rewrites the commit. The response carries `ok`, `error`, `staged_paths`, `skipped_paths`, `rejected_paths` and `hook_modified_paths`.

## Consequences

A commit made through the tool cannot include work the caller did not name, and unrelated staged entries survive both previews and commits, so the tool is safe in a shared tree. Callers must name every file, including for a pre-staged commit, which costs a little convenience. Hook-induced changes are detected rather than prevented; when one occurs the commit already exists and a human decides how to handle it. Serialisation covers only this server process, so other writers to the same repository remain bounded by Git's own locking and the `HEAD` checks. Any release carrying the narrowed enum is a semver-major decision for the owner. Re-adding a broad mode later would be an additive, separately recorded decision.
