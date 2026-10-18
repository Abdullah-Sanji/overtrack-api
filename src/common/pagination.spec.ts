import { describe, it, expect } from 'vitest';
import { parsePagination, paged } from './pagination';

describe('parsePagination', () => {
  it('defaults to page 1 size 20', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, offset: 0, limit: 20 });
  });
  it('caps pageSize at 100 and floors page at 1', () => {
    expect(parsePagination({ page: 0, pageSize: 500 })).toEqual({ page: 1, pageSize: 100, offset: 0, limit: 100 });
  });
  it('computes offset', () => {
    expect(parsePagination({ page: 3, pageSize: 10 }).offset).toBe(20);
  });
  it('wraps a page', () => {
    expect(paged([1, 2], 7, { page: 2, pageSize: 2 })).toEqual({ data: [1, 2], meta: { page: 2, pageSize: 2, total: 7 } });
  });
});
