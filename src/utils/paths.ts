import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

export const expandHome = (p: string): string => {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

/**
 * Resolve a candidate root path and verify it lives inside one of the configured
 * safe_roots. Resolves symlinks where the path exists; falls back to the deepest
 * existing ancestor otherwise. Returns the resolved absolute path.
 *
 * Throws if the input is relative, or if it escapes every safe root.
 */
export const resolveAgainstSafeRoots = async (input: string, safeRoots: readonly string[]): Promise<string> => {
  const { resolved } = await resolveAndLocateAgainstSafeRoots(input, safeRoots)
  return resolved
}

/**
 * Same containment check as `resolveAgainstSafeRoots`, but also returns the
 * realpath of the safe root that contains the input. Callers that need to
 * compute a path relative to its safe root (e.g. `repo_detail`) use this to
 * avoid duplicating the realpath work.
 */
export const resolveAndLocateAgainstSafeRoots = async (input: string, safeRoots: readonly string[]): Promise<{ resolved: string; containingRoot: string }> => {
  const expanded = expandHome(input)
  if (!path.isAbsolute(expanded)) {
    throw new Error(`root must be an absolute path or start with ~/: "${input}"`)
  }
  const realInput = await realpathOfDeepestExisting(expanded)
  const realSafeRoots = await Promise.all(safeRoots.map((r) => realpathOfDeepestExisting(r)))
  for (const realRoot of realSafeRoots) {
    if (realInput === realRoot) return { resolved: realInput, containingRoot: realRoot }
    /* v8 ignore next -- fs.realpath strips trailing separators, so realRoot only ends with `path.sep` when it IS the separator (filesystem root). Defensive branch. */
    const withSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
    if (realInput.startsWith(withSep)) return { resolved: realInput, containingRoot: realRoot }
  }
  throw new Error(`root "${input}" is not inside any configured safe_root (${safeRoots.join(', ')})`)
}

/**
 * Walk up `absPath` until we find a path that exists, then realpath that. This
 * lets us check "is this within the safe root" for paths that don't exist yet
 * without realpath returning ENOENT.
 */
const realpathOfDeepestExisting = async (absPath: string): Promise<string> => {
  let probe = absPath
  while (probe !== path.dirname(probe)) {
    try {
      await fs.access(probe)
      return await fs.realpath(probe)
    } catch {
      probe = path.dirname(probe)
    }
  }
  /* v8 ignore next -- the loop only exits without returning when we've walked all the way to the filesystem root without any ancestor existing, which is unreachable on a sane host (the root directory always exists). */
  return probe
}
