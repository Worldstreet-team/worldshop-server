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

/** How far ahead a deal may end. Long enough for a sale, short enough that
 * "deal" still means something to a buyer reading the home page. */
export const MAX_DEAL_DAYS = 30;

type DealShape = {
  priceType?: string | null;
  basePrice?: number | null;
  compareAtPrice?: number | null;
  dealEndsAt?: Date | null;
};

/**
 * Why a listing's deal is invalid, or null when it is fine (or there is no
 * deal). Shared by create, where it runs on the input, and update, where it
 * runs on the input merged over the stored listing.
 */
export function dealProblem(v: DealShape, now = new Date()): { path: string; message: string } | null {
  const hasWas = v.compareAtPrice != null;
  const hasEnd = v.dealEndsAt != null;
  if (!hasWas && !hasEnd) return null;
  if (!hasWas) return { path: 'compareAtPrice', message: 'Enter the price before the deal' };
  if (!hasEnd) return { path: 'dealEndsAt', message: 'Choose when the deal ends' };
  if ((v.priceType ?? 'FIXED') !== 'FIXED') {
    return { path: 'compareAtPrice', message: 'Only a fixed price can be on deal' };
  }
  if (v.basePrice == null || v.compareAtPrice! <= v.basePrice) {
    return { path: 'compareAtPrice', message: 'The price before the deal must be higher than the deal price' };
  }
  if (v.dealEndsAt! <= now) return { path: 'dealEndsAt', message: 'The deal must end in the future' };
  if (v.dealEndsAt!.getTime() - now.getTime() > MAX_DEAL_DAYS * 86_400_000) {
    return { path: 'dealEndsAt', message: `A deal can run for at most ${MAX_DEAL_DAYS} days` };
  }
  return null;
}

const dealFields = {
  compareAtPrice: z.number().positive().nullable().optional(),
  dealEndsAt: z.coerce.date().nullable().optional(),
};

export const createListingSchema = z.object({
  name: z.string().trim().min(3, 'Product name must be at least 3 characters').max(120),
  description: z.string().trim().min(20, 'Describe the product in at least 20 characters').max(5000),
  shortDesc: z.string().trim().max(200).optional(),
  categoryId: z.string().length(24, 'Choose a category'),

  priceType: z.enum(['FIXED', 'RANGE', 'ON_REQUEST']).default('FIXED'),
  basePrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  isNegotiable: z.boolean().default(true),
  ...dealFields,

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
    const deal = dealProblem(v);
    if (deal) ctx.addIssue({ code: 'custom', path: [deal.path], message: deal.message });
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
  // null clears the deal; checked against the stored listing in updateListing.
  ...dealFields,
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
