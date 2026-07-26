import { z } from 'zod';

// ─── Create Category ────────────────────────────────────────────
export const createCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  image: z.string().optional().nullable(),
  icon: z.string().max(100).optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// ─── Update Category ────────────────────────────────────────────
export const updateCategorySchema = createCategorySchema.partial().extend({
  /**
   * Renaming keeps the existing slug unless this is set. Category slugs appear
   * in browse URLs and vendor bookmarks, so silently re-slugging on every
   * rename breaks links as a side effect of fixing a typo.
   */
  regenerateSlug: z.boolean().optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ─── Category Attributes ────────────────────────────────────────
// The structured, filterable layer. Vendors fill these in; buyers filter on
// them. Anything that does not belong in a controlled vocabulary should be a
// per-product custom field instead.

export const createAttributeSchema = z
  .object({
    name: z.string().trim().min(1, 'Attribute name is required').max(60),
    type: z.enum(['SELECT', 'TEXT', 'NUMBER']).default('SELECT'),
    options: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
    isRequired: z.boolean().default(false),
    appliesTo: z.enum(['PRODUCT', 'VARIANT']).default('PRODUCT'),
    isFilterable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).default(0),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'SELECT' && v.options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'A SELECT attribute needs at least one option',
      });
    }
    if (v.type !== 'SELECT' && v.isFilterable) {
      ctx.addIssue({
        code: 'custom',
        path: ['isFilterable'],
        message: 'Only SELECT attributes can be filterable — free text has no shared vocabulary',
      });
    }
    const dupes = v.options.filter((o, i) => v.options.findIndex((x) => x.toLowerCase() === o.toLowerCase()) !== i);
    if (dupes.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: `Duplicate option "${dupes[0]}"` });
    }
  });

export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;

export const updateAttributeSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  type: z.enum(['SELECT', 'TEXT', 'NUMBER']).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  isRequired: z.boolean().optional(),
  appliesTo: z.enum(['PRODUCT', 'VARIANT']).optional(),
  isFilterable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;

// ─── Admin Category Query ───────────────────────────────────────
export const adminCategoryQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

export type AdminCategoryQueryInput = z.infer<typeof adminCategoryQuerySchema>;
