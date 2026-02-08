/**
 * Product & Category types for the backend.
 * These align with the Prisma schema and the frontend API contracts.
 */

// ─── Product Image (embedded JSON shape) ────────────────────────
export interface ProductImage {
  url: string;
  alt: string;
  isPrimary: boolean;
  sortOrder: number;
  cloudflareId?: string;
}

// ─── Query / Filter types ───────────────────────────────────────
export interface ProductQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  brand?: string;
  brands?: string[];
  rating?: number;
  inStock?: boolean;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  sortBy?: 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc' | 'newest' | 'rating' | 'popular';
}

// ─── Pagination ─────────────────────────────────────────────────
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: Pagination;
}

// ─── API Response wrappers ──────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
