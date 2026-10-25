export interface Pagination { page: number; pageSize: number; offset: number; limit: number }

export function parsePagination(q: { page?: number | string; pageSize?: number | string }): Pagination {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function paged<T>(data: T[], total: number, p: { page: number; pageSize: number }) {
  return { data, meta: { page: p.page, pageSize: p.pageSize, total } };
}
