import { z } from 'zod';
import { collapseToR2Key } from '../utils/signUrl';

/** See store.validator.ts for why branding images collapse to the bare key. */
const brandingImageSchema = z
  .string()
  .max(2000)
  .transform(collapseToR2Key)
  .refine((v) => v.length <= 300, 'Image reference is too long')
  .nullable()
  .optional();

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

export const createMallSchema = z.object({
  name: z
    .string()
    .min(3, 'Mall name must be at least 3 characters')
    .max(60, 'Mall name must be at most 60 characters'),
  description: z.string().max(1000, 'Description must be at most 1000 characters').optional(),
  state: stateSchema,
  city: z.string().max(60).optional(),
  address: z.string().max(200).optional(),
  planCode: z.string().max(40).optional(),
  ...contactSchema,
});

export type CreateMallInput = z.infer<typeof createMallSchema>;

export const updateMallSchema = z.object({
  name: z.string().min(3).max(60).optional(),
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
  // Renaming keeps the old slug unless this is explicitly set.
  regenerateSlug: z.boolean().optional(),
});

export type UpdateMallInput = z.infer<typeof updateMallSchema>;

/** Substores carry no planCode — the mall's subscription covers them. */
export const createSubstoreSchema = z.object({
  name: z
    .string()
    .min(3, 'Store name must be at least 3 characters')
    .max(60, 'Store name must be at most 60 characters'),
  description: z.string().max(1000).optional(),
  // Optional, unlike a personal store: a substore defaults to its mall's
  // location, which is where its counter physically is.
  state: stateSchema.optional(),
  city: z.string().max(60).optional(),
  address: z.string().max(200).optional(),
  ...contactSchema,
});

export type CreateSubstoreInput = z.infer<typeof createSubstoreSchema>;

export const updateSubstoreSchema = z.object({
  name: z.string().min(3).max(60).optional(),
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
  regenerateSlug: z.boolean().optional(),
});

export type UpdateSubstoreInput = z.infer<typeof updateSubstoreSchema>;

export const setFeaturedSchema = z.object({
  listingIds: z
    .array(z.string().regex(/^[0-9a-f]{24}$/, 'Invalid listing id'))
    .max(12, 'A mall can feature at most 12 products'),
});

export type SetFeaturedInput = z.infer<typeof setFeaturedSchema>;

export const mallQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  state: z.string().max(60).optional(),
});

export type MallQueryInput = z.infer<typeof mallQuerySchema>;
