import { z } from 'zod';

export const registerVendorSchema = z.object({
  storeName: z
    .string()
    .min(3, 'Store name must be at least 3 characters')
    .max(50, 'Store name must be at most 50 characters'),
  storeDescription: z
    .string()
    .max(500, 'Store description must be at most 500 characters')
    .optional(),
});

export type RegisterVendorInput = z.infer<typeof registerVendorSchema>;

export const updateVendorSchema = z.object({
  storeName: z
    .string()
    .min(3, 'Store name must be at least 3 characters')
    .max(50, 'Store name must be at most 50 characters')
    .optional(),
  storeDescription: z
    .string()
    .max(500, 'Store description must be at most 500 characters')
    .optional()
    .nullable(),
});

export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
