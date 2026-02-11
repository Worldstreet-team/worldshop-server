import { z } from 'zod';

// ─── Create Category ────────────────────────────────────────────
export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  image: z.string().url().optional().nullable(),
  icon: z.string().max(100).optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// ─── Update Category ────────────────────────────────────────────
export const updateCategorySchema = createCategorySchema.partial();

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ─── Admin Category Query ───────────────────────────────────────
export const adminCategoryQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

export type AdminCategoryQueryInput = z.infer<typeof adminCategoryQuerySchema>;
