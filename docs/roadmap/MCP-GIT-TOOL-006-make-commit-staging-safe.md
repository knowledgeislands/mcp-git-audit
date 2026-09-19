---
id: MCP-GIT-TOOL-006
title: Make commit staging safe
area: TOOL
theme: tool-surface
horizon: triage
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-19T11:40:44Z
updated_at: 2026-09-19T11:40:44Z
---

## Goal

Make `git_repo_commit` safe for working trees shared by humans and agent threads without silently staging unrelated changes.

## Context

The tool currently defaults `stage` to `all_tracked`, implements that as `git add -u`, and also offers `all` through `git add -A`. Its default-true dry run still performs that staging mutation before calling `git commit --dry-run`. The portable `ki-git` policy now treats every working tree as potentially shared, tracks touched paths at file granularity, and forbids whole-tree staging because it can absorb another actor's work.

## Boundary

This intake record does not select a replacement API, change the tool, or adopt work. Any later design must preserve an explicit preview flow, path validation, access gating, and compatibility decisions for existing callers.

## Discussion

### Shared-tree safety

A safe design should make explicit path selection the normal commit boundary and ensure preview does not leave an unrequested index mutation. It should decide whether broad staging modes are removed, isolated behind an exceptional opt-in, or represented by a different operation whose side effects are unmistakable.

### Compatibility

Changing the default or removing enum values affects the public MCP input schema and generated client. Planning should examine whether a staged-index-only mode remains useful and how callers migrate without preserving the unsafe default.
