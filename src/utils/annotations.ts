// @ki-managed ki-repo-mcp profile=modern-v2-core version=1
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const
export const READ_ONLY_REMOTE = { ...READ_ONLY, openWorldHint: true } as const
export const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const
export const WRITE_REMOTE = { ...WRITE, openWorldHint: true } as const
export const WRITE_IDEMPOTENT = { ...WRITE, idempotentHint: true } as const
export const WRITE_IDEMPOTENT_REMOTE = { ...WRITE_IDEMPOTENT, openWorldHint: true } as const
export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
} as const
export const DESTRUCTIVE_REMOTE = { ...DESTRUCTIVE, openWorldHint: true } as const
export const DESTRUCTIVE_ONESHOT = { ...DESTRUCTIVE, idempotentHint: false } as const
