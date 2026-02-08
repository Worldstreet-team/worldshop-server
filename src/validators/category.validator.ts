import { z } from 'zod';

// ─── Category Query Params ──────────────────────────────────────
export const categoryQuerySchema = z.object({
  includeProducts: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CategoryQueryInput = z.infer<typeof categoryQuerySchema>;

// ─── Category by slug with product pagination ───────────────────
export const categorySlugQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  brand: z.string().optional(),
  inStock: z
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

export type CategorySlugQueryInput = z.infer<typeof categorySlugQuerySchema>;
