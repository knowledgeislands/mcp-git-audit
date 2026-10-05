import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// dependency-cruiser supports TypeScript below 7, so the checker runs from its
// own install root; the repository's TypeScript 7 would yield an empty graph.
const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const tooling = join(root, 'tooling/boundaries')
const checker = join(tooling, 'node_modules/.bin/depcruise')
// Near the real source count, so a parser that stops reading the tree fails.
const moduleFloor = 48

interface Graph {
  modules: {
    source: string
    dependencies: { resolved: string; couldNotResolve: boolean; dependencyTypes: string[] }[]
  }[]
  summary: { violations: { from: string; to: string; rule: { name: string } }[] }
}

const cruise = async (cwd: string): Promise<Graph> => {
  try {
    const { stdout } = await execute(checker, ['--config', '.dependency-cruiser.ts', '--output-type', 'json', 'src'], {
      cwd,
      maxBuffer: 8 * 1024 * 1024
    })
    return JSON.parse(stdout) as Graph
  } catch (error) {
    // depcruise exits non-zero on violations; its JSON still names each rule.
    const { stdout } = error as { stdout?: string }
    if (stdout) return JSON.parse(stdout) as Graph
    throw error
  }
}

const rulesCrossing = (graph: Graph, source: string, target: string) =>
  graph.summary.violations.filter(({ from, to }) => from === source && to === target).map(({ rule }) => rule.name)

describe('module boundaries', () => {
  it('cruises the complete source graph with a supported transpiler', async () => {
    const { stdout } = await execute(
      'node',
      [
        '--input-type=module',
        '--eval',
        "import {getAvailableTranspilers} from 'dependency-cruiser'; console.log(JSON.stringify(getAvailableTranspilers()))"
      ],
      { cwd: tooling }
    )
    expect(JSON.parse(stdout)).toContainEqual(expect.objectContaining({ name: 'typescript', available: true }))

    const graph = await cruise(root)
    const owned = graph.modules.filter(({ source }) => source.startsWith('src/'))
    const edges = owned.flatMap(({ source, dependencies }) => dependencies.map((edge) => ({ source, ...edge })))
    expect(owned.length).toBeGreaterThanOrEqual(moduleFloor)
    expect(edges.filter((edge) => edge.couldNotResolve)).toEqual([])
    expect(
      edges.filter(
        (edge) =>
          edge.resolved.startsWith('src/') &&
          dirname(edge.resolved) !== dirname(edge.source) &&
          edge.dependencyTypes.includes('type-only')
      ).length
    ).toBeGreaterThan(0)
    expect(edges).toContainEqual(
      expect.objectContaining({
        source: 'src/tools/repo-audit/index.ts',
        resolved: 'src/main/repo-audit/index.ts',
        couldNotResolve: false
      })
    )
    expect(graph.summary.violations).toEqual([])
  }, 30_000)

  describe('rejects a deliberate crossing by rule name', () => {
    // Each source imports its target in a private synthetic tree; product source is never touched.
    const cases = [
      ['config-is-the-floor', 'src/config/index.ts', 'src/main/repo-sync/index.ts'],
      ['utils-stay-shared', 'src/utils/probe.ts', 'src/main/repo-sync/index.ts'],
      ['main-stays-transport-free', 'src/main/repo-sync/index.ts', 'src/tools/repo-sync/index.ts'],
      ['tools-stay-thin', 'src/tools/repo-audit/index.ts', 'src/main/repo-audit/scan.ts'],
      ['entrypoints-are-not-imported', 'src/tools/index.ts', 'src/mcp-server/index.ts'],
      [
        'registration-tests-keep-the-tool-seam',
        'src/tools/repo-sync/registration.test.ts',
        'src/main/repo-sync/index.ts'
      ],
      ['generated-client-is-not-imported', 'src/tools/repo-commit/index.ts', 'src/generated/client.ts']
    ] as const
    let fixture: string
    let graph: Graph

    beforeAll(async () => {
      fixture = await mkdtemp(join(tmpdir(), 'mcp-git-audit-boundaries-'))
      await writeFile(join(fixture, '.dependency-cruiser.ts'), await readFile(join(root, '.dependency-cruiser.ts')))
      await writeFile(
        join(fixture, 'tsconfig.json'),
        '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}'
      )
      const files = new Map<string, string[]>()
      for (const [, source, target] of cases) {
        files.set(target, files.get(target) ?? [])
        files.set(source, [...(files.get(source) ?? []), target])
      }
      for (const [file, targets] of files) {
        await mkdir(join(fixture, dirname(file)), { recursive: true })
        const imports = targets.map((target, index) => {
          const specifier = relative(dirname(file), target).replace(/\.ts$/, '.js')
          return `import type { Probe as P${index} } from '${specifier.startsWith('.') ? specifier : `./${specifier}`}'\n`
        })
        await writeFile(join(fixture, file), `${imports.join('')}export interface Probe { value: string }\n`)
      }
      graph = await cruise(fixture)
    }, 30_000)

    afterAll(async () => {
      await rm(fixture, { recursive: true, force: true })
    })

    it.each(cases)('%s', (name, source, target) => {
      expect(graph.modules.find((module) => module.source === source)?.dependencies).toContainEqual(
        expect.objectContaining({ resolved: target, couldNotResolve: false })
      )
      // Name the rule in the message so a disabled rule is reported by name.
      expect(rulesCrossing(graph, source, target), name).toContain(name)
    })
  })
})
