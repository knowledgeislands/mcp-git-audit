export const isNodeError = (err: unknown): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err
}

export const errMessage = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err)
}
