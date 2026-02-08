import type { Pagination, PaginatedResult } from '../types/product.types';

/**
 * buildPagination — Creates a Pagination metadata object.
 */
export function buildPagination(
  total: number,
  page: number,
  limit: number,
): Pagination {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * paginatedResult — Wraps data + pagination into the standard shape.
 */
export function paginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    pagination: buildPagination(total, page, limit),
  };
}
