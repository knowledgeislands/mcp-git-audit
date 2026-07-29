# Evaluate command-line repository criteria locally first

## Receiving repository

`knowledgeislands/ki-agentic-harness`

## Origin

`knowledgeislands/mcp-git-audit`, from a `ki-mcp` CONFORM sweep across the six `mcp-*` servers (2026-07-27/29). The behaviour was observed directly rather than inferred: all six repositories reported `FAIL=2` on `FILES-3` and `VIS-1` while their `.ki-config.toml` plainly carried the required qualified declarations, and the findings cleared to `FAIL=0` on `git push` alone, with no local file change. The evaluation path is stated in the module header of [`skills/keystone/ki-repo/scripts/rubric/contexts/audit.ts`](../../../../ki-agentic-harness/skills/keystone/ki-repo/scripts/rubric/contexts/audit.ts): committed files are read from the default branch via the git-tree API.

## Requested outcome

Make `ki repo audit` and `ki repo conform` **local-first by design** for every criterion whose subject exists in the working tree, so that a finding names something the operator can fix and re-verify without pushing. A command-line run is a development activity, and a criterion that cannot be satisfied until after a push inverts that loop.

Keep genuinely remote criteria remote. Those are the ones with no working-tree subject at all: default branch, merge and toggle configuration, topics, branch protection, required checks, security and Actions policy, repository access, and the _actual_ visibility of the repository.

Note that `VIS-1` is the instructive hybrid rather than a member of either group. It compares the **declared** visibility in `.ki-config.toml`, which is local, against the **actual** visibility on GitHub, which is remote. It currently fails when it cannot read the declaration, because it reads that declaration remotely too. Splitting the local and remote halves of a criterion is part of the work, not an edge case to defer.

Evaluating everything remotely is explicitly **not** in scope here. It is a wider concern tied to cloud and `--org` operation, and is better decided on its own terms than folded into this change.

## Constraints

- This changes a claim, not only a data source. Layer 1 file presence and `.ki-config.toml` content presently assert the state of the **published** repository, and [`references/standards-repository.md`](../../../../ki-agentic-harness/skills/keystone/ki-repo/references/standards-repository.md) documents that intent. Local-first evaluation asserts something weaker, so decide how published-state assurance is retained — a post-push run of the same audit in CI is the obvious candidate now that the released-CLI installer exists.
- `--org` mode audits repositories that are not cloned at all. Remote reading must remain a supported mode; it cannot simply be replaced.
- The affected criteria are `FILES-1`, `FILES-3`, `COV-1` (its cascade gate reads `.ki-config.toml` content), `PKG-1`, `RUNTIMES-1`, `RUNTIMES-2`, `STRUCT-1`, `STRUCT-2`, and the declaration half of `VIS-1`.
- The standards note added in `ki-agentic-harness` commit `706aed6a` describes today's remote evaluation and its consequences. It documents current behaviour deliberately, and must be rewritten rather than left in place if this change lands.

## Ownership and disposition

The receiving repository owns its roadmap placement, plan, implementation, tests, and commit. This is non-blocking for the originator: the `mcp-*` servers audit clean once pushed, so nothing here waits on it. Reply with the adopted roadmap or plan locator, a decline, or a supersession so this outbound brief can be removed.
