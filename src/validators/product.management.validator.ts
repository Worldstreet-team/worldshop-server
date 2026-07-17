import { z } from 'zod';

// ─── Shared Sub-Schemas ─────────────────────────────────────────

export const productImageSchema = z.object({
  url: z.string().refine(
    (val) => val.startsWith('/') || /^https?:\/\/.+/.test(val),
    { message: 'URL must be a valid absolute URL or a relative path starting with /' }
  ),
  alt: z.string().max(200).default(''),
  isPrimary: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  cloudflareId: z.string().optional(),
});

export const productVariantSchema = z.object({
  name: z.string().min(1).max(100),
  stockKeepingUnit: z.string().max(50).optional(),
  attributes: z.record(z.string(), z.string()).default({}),
  price: z.number().min(0).optional(),
  compareAtPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

// ─── Admin Create / Update ──────────────────────────────────────

export const adminCreateProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  description: z.string().min(1, 'Description is required'),
  shortDesc: z.string().max(500).optional(),
  stockKeepingUnit: z.string().max(50).optional(),
  basePrice: z.number().min(0, 'Price must be positive'),
  salePrice: z.number().min(0).optional().nullable(),
  type: z.enum(['PHYSICAL', 'DIGITAL']).default('PHYSICAL'),
  categoryId: z.string().optional().nullable(),
  brand: z.string().max(100).optional().nullable(),
  material: z.string().max(100).optional().nullable(),
  weightGrams: z.number().int().min(1).optional().nullable(),
  dimensions: z
    .object({
      length: z.number().min(0),
      width: z.number().min(0),
      height: z.number().min(0),
      unit: z.enum(['cm', 'in']).default('cm'),
    })
    .optional()
    .nullable(),
  tags: z.array(z.string().max(50)).default([]),
  images: z.array(productImageSchema).default([]),
  variants: z.array(productVariantSchema).optional(),
  stock: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isNewArrival: z.boolean().default(true),
});

export type AdminCreateProductInput = z.infer<typeof adminCreateProductSchema>;

export const adminUpdateProductSchema = adminCreateProductSchema.partial();
export type AdminUpdateProductInput = z.infer<typeof adminUpdateProductSchema>;

// ─── Vendor Create / Update ─────────────────────────────────────

export const productDimensionsSchema = z.object({
  length: z.number().min(0),
  width: z.number().min(0),
  height: z.number().min(0),
  unit: z.enum(['cm', 'in']).default('cm'),
});

// Listing standards (Test 8): a vendor listing must carry a category, and a
// PHYSICAL listing must carry at least one image. Category-specific attribute
// requirements (Size, Color, …) are validated in listing-standards.service,
// which needs the database.
const vendorProductBaseSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  description: z.string().min(1, 'Description is required'),
  shortDesc: z.string().max(500).optional(),
  basePrice: z.number().min(0, 'Price must be positive'),
  salePrice: z.number().min(0).optional().nullable(),
  categoryId: z.string().min(1, 'Category is required'),
  brand: z.string().max(100).optional().nullable(),
  material: z.string().max(100).optional().nullable(),
  weightGrams: z.number().int().min(1).optional().nullable(),
  dimensions: productDimensionsSchema.optional().nullable(),
  type: z.enum(['PHYSICAL', 'DIGITAL']).default('DIGITAL'),
  stock: z.number().int().min(0).optional(),
  tags: z.array(z.string().max(50)).default([]),
  images: z.array(productImageSchema).default([]),
  variants: z.array(productVariantSchema).optional(),
});

export const vendorCreateProductSchema = vendorProductBaseSchema.superRefine(
  (data, ctx) => {
    if (data.type === 'PHYSICAL' && data.images.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['images'],
        message: 'At least one product image is required for physical products',
      });
    }
  },
);

export type VendorCreateProductInput = z.input<typeof vendorCreateProductSchema>;

// Partial for updates — the image/category/attribute rules are re-checked in
// the service against the MERGED product state, since a PUT may omit fields.
export const vendorUpdateProductSchema = vendorProductBaseSchema.partial();
export type VendorUpdateProductInput = z.infer<typeof vendorUpdateProductSchema>;

// ─── Shared List Query ──────────────────────────────────────────

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  categoryId: z.string().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  stock: z.enum(['in-stock', 'low-stock', 'out-of-stock', 'all']).default('all'),
  sortBy: z.enum([
    'name_asc', 'name_desc',
    'price_asc', 'price_desc',
    'stock_asc', 'stock_desc',
    'newest', 'oldest',
  ]).default('newest'),
});

export type ProductListQueryInput = z.infer<typeof productListQuerySchema>;

// ─── Toggle ─────────────────────────────────────────────────────

export const toggleProductSchema = z.object({
  isActive: z.boolean(),
});

export type ToggleProductInput = z.infer<typeof toggleProductSchema>;

export const adminProductVisibilitySchema = z.object({
  isActive: z.boolean(),
});

export type AdminProductVisibilityInput = z.infer<typeof adminProductVisibilitySchema>;

export const adminProductApprovalSchema = z.object({
  approvalStatus: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

export type AdminProductApprovalInput = z.infer<typeof adminProductApprovalSchema>;
