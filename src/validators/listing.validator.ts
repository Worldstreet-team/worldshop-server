import { z } from 'zod';

/**
 * Custom fields are the vendor's own spec rows. They are capped not to be
 * mean but because they render as a table on the product page and because
 * unbounded user-supplied keys are a storage and rendering hazard.
 */
const MAX_CUSTOM_FIELDS = 30;

const customFieldSchema = z.object({
  label: z.string().trim().min(1, 'Field name is required').max(40),
  value: z.string().trim().min(1, 'Field value is required').max(500),
});

const customFieldsSchema = z
  .array(customFieldSchema)
  .max(MAX_CUSTOM_FIELDS, `At most ${MAX_CUSTOM_FIELDS} custom fields per product`)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      const key = f.label.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'label'],
          message: `Duplicate field name "${f.label}"`,
        });
      }
      seen.add(key);
    });
  });

/** Admin-defined attribute values. Validated properly against the category. */
const attributesSchema = z.record(z.string().max(60), z.union([z.string().max(200), z.number()]));

const variantSchema = z.object({
  name: z.string().trim().min(1).max(80),
  attributes: z.record(z.string().max(60), z.string().max(200)),
  price: z.number().nonnegative().optional(),
  isAvailable: z.boolean().optional(),
  images: z.array(z.record(z.string(), z.unknown())).max(8).optional(),
});

export const createListingSchema = z.object({
  name: z.string().trim().min(3, 'Product name must be at least 3 characters').max(120),
  description: z.string().trim().min(20, 'Describe the product in at least 20 characters').max(5000),
  shortDesc: z.string().trim().max(200).optional(),
  categoryId: z.string().length(24, 'Choose a category'),

  priceType: z.enum(['FIXED', 'RANGE', 'ON_REQUEST']).default('FIXED'),
  basePrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  isNegotiable: z.boolean().default(true),

  condition: z.enum(['NEW', 'USED', 'REFURBISHED']).optional(),
  brand: z.string().trim().max(60).optional(),
  material: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().max(30)).max(15).default([]),
  images: z.array(z.record(z.string(), z.unknown())).max(12).default([]),

  attributes: attributesSchema.optional(),
  customFields: customFieldsSchema.default([]),
  variants: z.array(variantSchema).max(50).default([]),

  // Defaults to the store's location when omitted.
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
})
  .superRefine((v, ctx) => {
    if (v.priceType === 'FIXED' && v.basePrice == null) {
      ctx.addIssue({ code: 'custom', path: ['basePrice'], message: 'A price is required' });
    }
    if (v.priceType === 'RANGE') {
      if (v.basePrice == null || v.maxPrice == null) {
        ctx.addIssue({ code: 'custom', path: ['maxPrice'], message: 'A price range needs both a minimum and a maximum' });
      } else if (v.maxPrice < v.basePrice) {
        ctx.addIssue({ code: 'custom', path: ['maxPrice'], message: 'Maximum price cannot be below the minimum' });
      }
    }
  });

export type CreateListingInput = z.infer<typeof createListingSchema>;

/** Same shape, all optional — a vendor edits one field at a time. */
export const updateListingSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(20).max(5000).optional(),
  shortDesc: z.string().trim().max(200).nullable().optional(),
  categoryId: z.string().length(24).optional(),
  priceType: z.enum(['FIXED', 'RANGE', 'ON_REQUEST']).optional(),
  basePrice: z.number().nonnegative().nullable().optional(),
  maxPrice: z.number().nonnegative().nullable().optional(),
  isNegotiable: z.boolean().optional(),
  condition: z.enum(['NEW', 'USED', 'REFURBISHED']).nullable().optional(),
  brand: z.string().trim().max(60).nullable().optional(),
  material: z.string().trim().max(60).nullable().optional(),
  tags: z.array(z.string().trim().max(30)).max(15).optional(),
  images: z.array(z.record(z.string(), z.unknown())).max(12).optional(),
  attributes: attributesSchema.optional(),
  customFields: customFieldsSchema.optional(),
  variants: z.array(variantSchema).max(50).optional(),
  state: z.string().trim().max(60).nullable().optional(),
  city: z.string().trim().max(60).nullable().optional(),
});

export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN', 'REMOVED']).optional(),
  categoryId: z.string().length(24).optional(),
  search: z.string().trim().max(100).optional(),
});

export type ListingQueryInput = z.infer<typeof listingQuerySchema>;
