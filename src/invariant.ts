/** Assorted runtime invariants and assertions. */
export function assert(value: unknown, message?: string): asserts value {
  if (!value) throw new Error(message ?? 'assertion failed')
}

export function assertNonNullable<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) throw new Error(message ?? 'expected non-nullable value')
  return value
}

/** Assert a plain record payload (JSON body guards). */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
