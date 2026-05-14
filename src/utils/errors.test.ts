import { describe, expect, it } from 'vitest'
import { errMessage, isNodeError } from './errors.js'

describe('isNodeError', () => {
  it('returns true for ENOENT-shaped errors', () => {
    const e = Object.assign(new Error('x'), { code: 'ENOENT' })
    expect(isNodeError(e)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isNodeError(new Error('x'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isNodeError('s')).toBe(false)
    expect(isNodeError(null)).toBe(false)
  })
})

describe('errMessage', () => {
  it('returns the message for an Error', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errMessage('boom')).toBe('boom')
    expect(errMessage(42)).toBe('42')
  })
})
