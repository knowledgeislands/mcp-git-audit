import * as os from 'node:os'
import * as path from 'node:path'
import { defineConfig } from 'vitest/config'

const TEST_ROOT = path.join(os.tmpdir(), 'mcp-git-audit-tests')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      MCP_GIT_AUDIT_SAFE_ROOTS: TEST_ROOT
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Server entry points and tool registration aggregators are pure
        // wiring (every line is `server.registerTool(...)`); their behaviour
        // is exercised by `npm run inspect` and the smoke test in CI.
        'src/mcp-server/index.ts',
        'src/tools/index.ts',
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
