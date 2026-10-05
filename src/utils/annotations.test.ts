import { describe, expect, it } from 'vitest'
import { levelFromAnnotations } from './access-level.js'
import * as presets from './annotations.js'

describe('managed annotation vocabulary', () => {
  it.each([
    ['READ_ONLY', 'read'],
    ['READ_ONLY_REMOTE', 'read'],
    ['WRITE', 'write'],
    ['WRITE_REMOTE', 'write'],
    ['WRITE_IDEMPOTENT', 'write'],
    ['WRITE_IDEMPOTENT_REMOTE', 'write'],
    ['DESTRUCTIVE', 'destructive'],
    ['DESTRUCTIVE_REMOTE', 'destructive'],
    ['DESTRUCTIVE_ONESHOT', 'destructive']
  ] as const)('%s preserves its registration tier', (name, level) => {
    expect(levelFromAnnotations(presets[name])).toBe(level)
    expect(presets[name].openWorldHint).toBe(name.endsWith('_REMOTE'))
  })

  it('distinguishes repeated-state writes from one-shot commits', () => {
    expect(presets.WRITE_IDEMPOTENT.idempotentHint).toBe(true)
    expect(presets.DESTRUCTIVE_ONESHOT.idempotentHint).toBe(false)
  })
})
