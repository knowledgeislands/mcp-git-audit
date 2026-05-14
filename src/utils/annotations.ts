/**
 * MCP tool annotations shared across tool groups.
 *
 * - READ_ONLY — pure read tools that can be called freely (closed-world; the
 *   tool only inspects local git state).
 */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
