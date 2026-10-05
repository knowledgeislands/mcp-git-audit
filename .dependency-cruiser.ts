import type { IConfiguration } from 'dependency-cruiser'

/** One or more top-level areas under `src/`, matched as whole directories. */
const areas = (...names: readonly string[]) => `^src/(${names.join('|')})(/|$)`
/** Everything the repository owns; anything else is a dependency. */
const owned = '^src/'
const testFile = '\\.test\\.ts$'
const entrypoints = areas('mcp-server')

const config: IConfiguration = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A cycle is two modules disagreeing about which of them is underneath.',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-unresolvable',
      comment: 'Every rule matches resolved paths, so an unresolved import would cross any boundary unseen.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: 'config-is-the-floor',
      comment: 'Configuration is a plain value every layer receives; it depends on no implementation that consumes it.',
      severity: 'error',
      from: { path: areas('config') },
      to: { path: owned, pathNot: areas('config') }
    },
    {
      name: 'utils-stay-shared',
      comment:
        "Helpers shared verbatim with sibling MCPs take config primitives, never this server's implementations, tools or emitted client.",
      severity: 'error',
      from: { path: areas('utils') },
      to: { path: areas('main', 'tools', 'mcp-server', 'generated') }
    },
    {
      name: 'main-stays-transport-free',
      comment:
        'Implementations in main/ are usable from a script: they never reach the tool layer, the entrypoints or the MCP SDK.',
      severity: 'error',
      from: { path: areas('main') },
      to: { path: `${areas('tools', 'mcp-server', 'generated')}|(^|/)node_modules/@modelcontextprotocol/` }
    },
    {
      name: 'tools-stay-thin',
      comment:
        'A tool module declares schema and annotations, validates identifiers and paths, hands its arguments to a main/ entrypoint and wraps the result in an MCP envelope; logic reached past that surface escapes the tested implementation.',
      severity: 'error',
      from: { path: areas('tools'), pathNot: testFile },
      to: {
        path: owned,
        pathNot: `^src/(tools|main/[^/]+/index\\.ts$|config/index\\.ts$|utils/(annotations|errors|git-exec|paths|results)\\.ts$)`
      }
    },
    {
      name: 'entrypoints-are-not-imported',
      comment: 'The MCP server loads configuration and starts the process; nothing else may import it.',
      severity: 'error',
      from: { path: owned, pathNot: entrypoints },
      to: { path: entrypoints }
    },
    {
      name: 'registration-tests-keep-the-tool-seam',
      comment:
        'Registration tests drive the registered handlers against real Git fixtures and validate wire schemas; they reach main/ only through the tool module, never directly.',
      severity: 'error',
      from: { path: `^src/tools/.+${testFile}` },
      to: { path: areas('main', 'mcp-server') }
    },

    {
      name: 'generated-client-is-not-imported',
      comment:
        'src/generated/ is the mcporter-emitted client for external consumers, outside the build and lint; product source never depends on it.',
      severity: 'error',
      from: { path: owned, pathNot: areas('generated') },
      to: { path: areas('generated') }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // A type-only import crosses a boundary exactly as a value import does.
    tsPreCompilationDeps: true,
    // The MCP SDK and Zod resolve only through subpath exports.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.d.ts', '.json']
    }
  }
}

export default config
