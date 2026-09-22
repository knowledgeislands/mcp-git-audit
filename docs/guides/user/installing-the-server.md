# Installing the server

Get `mcp-git-audit` built, connected to an MCP client, and answering a first question about a real repository. Expect ten minutes.

## Before you start

You need [Bun](https://bun.sh) 1.3 or later to install dependencies and build, and Node.js 22 or later to run the built server — that is what your MCP client will actually launch. You also need `git` on `PATH`, since every answer this server gives comes from shelling out to it.

> [!NOTE] There is no published package yet. The npm badge in the README points at a name that is not on the registry, so install from source; `npx @knowledgeislands/mcp-git-audit` will not work.

## Build it

```bash
git clone https://github.com/knowledgeislands/mcp-git-audit.git
cd mcp-git-audit
bun install
bun run build
```

`bun run build` emits `dist/`, and `dist/mcp-server/index.js` is the entry point your client runs. Note its absolute path — you will need it in the next step.

## Decide which directories it may read

`MCP_GIT_AUDIT_SAFE_ROOTS` is a colon-separated list of directories the server may walk. It is the server's entire security boundary: every `root` argument, and every absolute path handed back to a later call, must equal or live inside one of these entries after `~` expansion and symlink resolution. A path that escapes them is refused before any `git` runs.

Unset, it defaults to `~` — your whole home directory. That is deliberately a bound rather than a recommendation: it keeps the server out of `/etc` and `/opt`, but it does not keep it out of anything of yours. Name the directories you actually keep code in:

```text
MCP_GIT_AUDIT_SAFE_ROOTS=~/dev:~/work
```

Two habits are worth forming here. Point at the parent of your repositories, not at a single repository, because the walk is what makes the server useful. And keep the list short: each entry widens what a confused or adversarial prompt can ask about.

## Connect it to a client

Configuration reaches the server through the client's `env` block, not through a `.env` file. The server only reads `.env.*` files when `NODE_ENV` is set to `development`, which the development scripts do and your client does not.

For Claude Desktop, add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-git-audit": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-git-audit/dist/mcp-server/index.js"],
      "env": {
        "MCP_GIT_AUDIT_SAFE_ROOTS": "~/dev"
      }
    }
  }
}
```

A copyable version of that block is in [`claude-config-sample.json`](../../../claude-config-sample.json).

Claude Code takes the same command, arguments, and environment through `claude mcp add`, and any other MCP client that launches a stdio server — mcporter included — needs exactly those three pieces: the `node` command, the absolute path to `dist/mcp-server/index.js`, and the environment block.

Then restart the client. The server reads its configuration once at startup and never re-reads it, so every configuration change from here on needs a restart to take effect.

## Confirm it works

Ask the client to list its tools. On a default install you should see five, all read-only: `git_repos_scan`, `git_repos_audit`, `git_repo_detail`, `git_repo_diff`, and `git_repo_remotes_list`. If you see twelve, the access level is not at its default — see [Granting write access](granting-write-access.md). If you see none, see [Troubleshooting](troubleshooting.md).

Then ask for something real: _scan `~/dev` and tell me which repositories have uncommitted changes_. A first answer that names repositories you recognise confirms the whole path — client launch, configuration, allow-list, and `git` invocation. [Auditing repositories](auditing-repositories.md) takes it from there.

## Changing the configuration later

Every setting is an environment variable in the client's `env` block, and every one of them is optional:

- **`MCP_GIT_AUDIT_SAFE_ROOTS`** — the directories above. Defaults to `~`.
- **`MCP_GIT_AUDIT_ACCESS_LEVEL`** — `read`, `write`, or `destructive`. Defaults to `read`. See [Granting write access](granting-write-access.md).
- **`MCP_GIT_AUDIT_AUDIT_LOG`** — `off`, `writes`, or `all`. Defaults to `writes`.
- **`MCP_GIT_AUDIT_AUDIT_LOG_PATH`** — where the JSONL log is written. Defaults to `~/.local/state/mcp-git-audit/audit.jsonl`.
- **`MCP_GIT_AUDIT_AUDIT_LOG_MAX_BYTES`** — rotate once the log passes this size. Defaults to `10485760` (10 MiB); `0` disables rotation.
- **`MCP_GIT_AUDIT_AUDIT_LOG_KEEP`** — how many rotated logs to retain. Defaults to `5`.

An unrecognised value for the access level or the log mode aborts startup rather than falling back to a default, so a typo shows up as a server that will not start rather than as a quietly wrong setting. [`.env.example`](../../../.env.example) documents the same set with inline commentary.
