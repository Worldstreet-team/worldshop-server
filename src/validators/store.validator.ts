import { z } from 'zod';
import { collapseToR2Key } from '../utils/signUrl';

/**
 * Branding images arrive as whatever the client had on hand: a bare R2 key
 * from a fresh upload, or a full presigned URL (~400-500 chars) echoed back
 * from GET /stores/me, which signs stored keys for display. Collapse to the
 * bare key before length-checking so a signed URL round-trip never fails the
 * save; the generous pre-collapse cap only guards against garbage input.
 */
const brandingImageSchema = z
  .string()
  .max(2000)
  .transform(collapseToR2Key)
  .refine((v) => v.length <= 300, 'Image reference is too long')
  .nullable()
  .optional();

/** Nigerian states are the primary browse filter, so location is required. */
const stateSchema = z.string().min(2, 'State is required').max(60);

const contactSchema = {
  phone: z
    .string()
    .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number')
    .optional(),
  whatsapp: z
    .string()
    .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid WhatsApp number')
    .optional(),
  email: z.string().email('Enter a valid email address').optional(),
  website: z.string().url('Enter a valid URL').max(200).optional(),
};

export const createStoreSchema = z.object({
  name: z
    .string()
    .min(3, 'Store name must be at least 3 characters')
    .max(60, 'Store name must be at most 60 characters'),
  description: z.string().max(1000, 'Description must be at most 1000 characters').optional(),
  state: stateSchema,
  city: z.string().max(60).optional(),
  address: z.string().max(200).optional(),
  planCode: z.string().max(40).optional(),
  ...contactSchema,
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const updateStoreSchema = z.object({
  name: z.string().min(3).max(60).optional(),
  // Contact fields are nullable here, unlike on create: `optional` alone means
  // "omit to keep", leaving no way to CLEAR a phone number once set. null
  // unsets the field.
  phone: z.string().regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number').nullable().optional(),
  whatsapp: z.string().regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid WhatsApp number').nullable().optional(),
  email: z.string().email('Enter a valid email address').nullable().optional(),
  website: z.string().url('Enter a valid URL').max(200).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  logo: brandingImageSchema,
  banner: brandingImageSchema,
  state: stateSchema.optional(),
  city: z.string().max(60).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  openingHours: z.record(z.string(), z.unknown()).nullable().optional(),
  // Renaming keeps the old slug unless this is explicitly set — existing links
  // to the store should not break as a side effect of an edit.
  regenerateSlug: z.boolean().optional(),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

export const storeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  state: z.string().max(60).optional(),
});

export type StoreQueryInput = z.infer<typeof storeQuerySchema>;
