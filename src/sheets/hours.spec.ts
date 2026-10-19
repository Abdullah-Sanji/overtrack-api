import { describe, it, expect } from 'vitest';
import { hoursBetween, isQuarterStep, weighted } from './hours';

describe('hours helpers', () => {
  it('computes hours between times rounded to quarter', () => {
    expect(hoursBetween('18:00', '20:30')).toBe(2.5);
    expect(hoursBetween('18:00', '18:10')).toBe(0.25);
    expect(hoursBetween('09:00', '09:00')).toBe(0);
    expect(hoursBetween('20:00', '18:00')).toBe(-2);
  });
  it('validates quarter steps', () => {
    expect(isQuarterStep(1.25)).toBe(true); expect(isQuarterStep(1.3)).toBe(false); expect(isQuarterStep(16)).toBe(true);
  });
  it('weights and rounds', () => { expect(weighted(2.5, 1.5)).toBe(3.75); expect(weighted(0.25, 2.5)).toBe(0.63); });
});
