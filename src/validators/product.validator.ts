import { z } from 'zod';

// ─── Product Query Params ───────────────────────────────────────
export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  search: z.string().max(200).optional(),
  categoryId: z.string().optional(),
  categorySlug: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  brand: z.string().optional(),
  rating: z.coerce.number().min(1).max(5).optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  isFeatured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z
    .enum([
      'price_asc',
      'price_desc',
      'name_asc',
      'name_desc',
      'newest',
      'rating',
      'popular',
    ])
    .optional(),
});

export type ProductQueryInput = z.infer<typeof productQuerySchema>;

// ─── Featured / Related limits ──────────────────────────────────
export const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export type FeaturedQueryInput = z.infer<typeof featuredQuerySchema>;

export const relatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type RelatedQueryInput = z.infer<typeof relatedQuerySchema>;

// ─── Search ─────────────────────────────────────────────────────
export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required').max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
