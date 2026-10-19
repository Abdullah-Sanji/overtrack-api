import { describe, it, expect } from 'vitest';
import { uniqueViolationConstraint, foreignKeyViolationConstraint } from './pg';

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

describe('foreignKeyViolationConstraint', () => {
  it('returns the constraint for an unwrapped foreign-key violation', () => {
    expect(foreignKeyViolationConstraint({ code: '23503', constraint: 'teams_tech_lead_id_users_id_fk' })).toBe('teams_tech_lead_id_users_id_fk');
  });
  it('returns the constraint when wrapped in err.cause (drizzle)', () => {
    const err = Object.assign(new Error('Failed query'), { cause: { code: '23503', constraint: 'teams_tech_lead_id_users_id_fk' } });
    expect(foreignKeyViolationConstraint(err)).toBe('teams_tech_lead_id_users_id_fk');
  });
  it('returns null for a unique violation and plain errors', () => {
    expect(foreignKeyViolationConstraint({ code: '23505', constraint: 'teams_name_unique' })).toBeNull();
    expect(foreignKeyViolationConstraint(new Error('x'))).toBeNull();
  });
});
