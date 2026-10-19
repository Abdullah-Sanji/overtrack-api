/** Returns the violated constraint name when err (or err.cause) carries the given Postgres SQLSTATE code, else null. */
function constraintForCode(err: unknown, code: string): string | null {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      (candidate as { code?: unknown }).code === code &&
      typeof (candidate as { constraint?: unknown }).constraint === 'string'
    ) {
      return (candidate as { constraint: string }).constraint;
    }
  }
  return null;
}

/** Returns the violated constraint name when err (or err.cause) is a Postgres unique violation (SQLSTATE 23505), else null. */
export const uniqueViolationConstraint = (err: unknown): string | null => constraintForCode(err, '23505');

/** Returns the violated constraint name when err (or err.cause) is a Postgres foreign-key violation (SQLSTATE 23503), else null. */
export const foreignKeyViolationConstraint = (err: unknown): string | null => constraintForCode(err, '23503');
