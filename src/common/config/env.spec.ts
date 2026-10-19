import { describe, it, expect } from 'vitest';
import { parseTrustProxy } from './env';

describe('parseTrustProxy', () => {
  it('parses booleans and hop counts', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
  });
  it('rejects garbage', () => { expect(() => parseTrustProxy('yes')).toThrow(); });
});
