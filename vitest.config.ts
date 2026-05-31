import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    // The MCP's own config is loaded explicitly via loadConfig() and passed into
    // calls — nothing reads process.env at import time, and tests build their own
    // Config / AuditConfig (or pass an explicit safeRoots list). The only env we
    // seed is git-config isolation: every test git invocation spreads
    // ...process.env, so this keeps the suite independent of the host's git config.
    // GIT_CONFIG_COUNT=0 drops any inherited `-c`-style overrides (e.g. a
    // safe.bareRepository=explicit injected via GIT_CONFIG_KEY_n/VALUE_n, which
    // otherwise breaks the bare-remote fixtures the sync tests push to / fetch
    // from); the /dev/null pair neutralises global + system config files.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_COUNT: '0'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Server entry point and tool registration aggregators are pure wiring
        // (every line is `server.registerTool(...)` or a re-export); their
        // behaviour is exercised by `bun run server:mcp:inspect`, the smoke
        // test in CI, and the per-area main tests they delegate to.
        'src/mcp-server/index.ts',
        'src/tools/**/index.ts',
        // Pure data: annotation presets are referenced only from tool
        // registration sites (which are themselves excluded).
        'src/utils/annotations.ts'
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
})
