import { describe, it, expect } from 'vitest';
import { uniqueViolationConstraint } from './pg';

describe('uniqueViolationConstraint', () => {
  it('returns the constraint for an unwrapped unique violation', () => {
    expect(uniqueViolationConstraint({ code: '23505', constraint: 'users_email_idx' })).toBe('users_email_idx');
  });
  it('returns the constraint when wrapped in err.cause (drizzle)', () => {
    const err = Object.assign(new Error('Failed query'), { cause: { code: '23505', constraint: 'teams_name_unique' } });
    expect(uniqueViolationConstraint(err)).toBe('teams_name_unique');
  });
  it('returns null for other SQLSTATE codes and plain errors', () => {
    expect(uniqueViolationConstraint({ code: '23503' })).toBeNull();
    expect(uniqueViolationConstraint(new Error('x'))).toBeNull();
  });
});
