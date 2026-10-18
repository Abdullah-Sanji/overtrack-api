/** Returns the violated constraint name when err (or err.cause) is a Postgres unique violation (SQLSTATE 23505), else null. */
export function uniqueViolationConstraint(err: unknown): string | null {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      (candidate as { code?: unknown }).code === '23505' &&
      typeof (candidate as { constraint?: unknown }).constraint === 'string'
    ) {
      return (candidate as { constraint: string }).constraint;
    }
  }
  return null;
}
