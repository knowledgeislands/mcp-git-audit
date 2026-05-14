import { describe, expect, it } from 'vitest'
import { errorResult, jsonResult } from './results.js'

describe('errorResult', () => {
  it('builds the MCP error response shape', () => {
    expect(errorResult('boom')).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] })
  })
})

describe('jsonResult', () => {
  it('serialises a payload to pretty JSON in a text block', () => {
    const r = jsonResult({ a: 1 })
    expect(r.content[0].type).toBe('text')
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 })
  })
})
