// @ts-nocheck
// Generated on 2026-07-19T22:15:50.649Z by @knowledgeislands/mcp-git-audit@1.0.0
// Server: kit-mcp-git-audit
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/workspaces/kis/knowledgeislands/mcp-git-audit/dist/mcp-server/index.js

import { createRuntime, createServerProxy, wrapCallResult } from 'mcporter';
import type { KitMcpGitAuditTools } from './types';

type RuntimeInstance = Awaited<ReturnType<typeof createRuntime>>;
export type KitMcpGitAuditClient = KitMcpGitAuditTools & { close(): Promise<void> };

export interface CreateClientOptions {
  runtime?: RuntimeInstance;
  configPath?: string;
  rootDir?: string;
}

export async function createKitMcpGitAuditClient(options: CreateClientOptions = {}): Promise<KitMcpGitAuditClient> {
  const runtime = options.runtime ?? (await createRuntime({
    configPath: options.configPath,
    rootDir: options.rootDir,
  }));
  const ownsRuntime = !options.runtime;
  const proxy = createServerProxy(runtime, "kit-mcp-git-audit");
  const client: KitMcpGitAuditClient = {
    async git_repos_scan(params: Parameters<KitMcpGitAuditTools["git_repos_scan"]>[0]) {
      const tool = proxy.gitReposScan as (args: Parameters<KitMcpGitAuditTools["git_repos_scan"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repos_audit(params: Parameters<KitMcpGitAuditTools["git_repos_audit"]>[0]) {
      const tool = proxy.gitReposAudit as (args: Parameters<KitMcpGitAuditTools["git_repos_audit"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_detail(params: Parameters<KitMcpGitAuditTools["git_repo_detail"]>[0]) {
      const tool = proxy.gitRepoDetail as (args: Parameters<KitMcpGitAuditTools["git_repo_detail"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_fetch(params: Parameters<KitMcpGitAuditTools["git_repo_fetch"]>[0]) {
      const tool = proxy.gitRepoFetch as (args: Parameters<KitMcpGitAuditTools["git_repo_fetch"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_pull(params: Parameters<KitMcpGitAuditTools["git_repo_pull"]>[0]) {
      const tool = proxy.gitRepoPull as (args: Parameters<KitMcpGitAuditTools["git_repo_pull"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_push(params: Parameters<KitMcpGitAuditTools["git_repo_push"]>[0]) {
      const tool = proxy.gitRepoPush as (args: Parameters<KitMcpGitAuditTools["git_repo_push"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_remotes_list(params: Parameters<KitMcpGitAuditTools["git_repo_remotes_list"]>[0]) {
      const tool = proxy.gitRepoRemotesList as (args: Parameters<KitMcpGitAuditTools["git_repo_remotes_list"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_remote_set_url(params: Parameters<KitMcpGitAuditTools["git_repo_remote_set_url"]>[0]) {
      const tool = proxy.gitRepoRemoteSetUrl as (args: Parameters<KitMcpGitAuditTools["git_repo_remote_set_url"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_remote_add(params: Parameters<KitMcpGitAuditTools["git_repo_remote_add"]>[0]) {
      const tool = proxy.gitRepoRemoteAdd as (args: Parameters<KitMcpGitAuditTools["git_repo_remote_add"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_remote_remove(params: Parameters<KitMcpGitAuditTools["git_repo_remote_remove"]>[0]) {
      const tool = proxy.gitRepoRemoteRemove as (args: Parameters<KitMcpGitAuditTools["git_repo_remote_remove"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_diff(params: Parameters<KitMcpGitAuditTools["git_repo_diff"]>[0]) {
      const tool = proxy.gitRepoDiff as (args: Parameters<KitMcpGitAuditTools["git_repo_diff"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async git_repo_commit(params: Parameters<KitMcpGitAuditTools["git_repo_commit"]>[0]) {
      const tool = proxy.gitRepoCommit as (args: Parameters<KitMcpGitAuditTools["git_repo_commit"]>[0]) => Promise<unknown>;
      const raw = await tool(params);
      return wrapCallResult(raw).callResult;
    },

    async close() {
      if (ownsRuntime) {
        await runtime.close("kit-mcp-git-audit").catch(() => {});
      }
    },
  };
  return client;
}

