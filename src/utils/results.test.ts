import { describe, expect, it } from 'vitest'
import { errorResult, jsonResult } from './results.js'

describe('errorResult', () => {
  it('builds the MCP error response shape with an action prefix', () => {
    expect(errorResult('scanning repos', new Error('boom'))).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Error scanning repos: boom' }]
    })
  })

  it('coerces a non-Error value via errMessage', () => {
    expect(errorResult('committing', 'kaboom')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Error committing: kaboom' }]
    })
  })
})

describe('jsonResult', () => {
  it('serialises a payload to pretty JSON in a text block', () => {
    const r = jsonResult({ a: 1 })
    expect(r.content[0].type).toBe('text')
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 })
  })
})
