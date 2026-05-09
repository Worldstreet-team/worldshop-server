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

export const withdrawalAccountSchema = z.object({
  bankName: z.string().min(2, 'Bank name is required').max(100),
  accountNumber: z.string().min(6).max(20).regex(/^\d+$/, 'Account number must contain digits only'),
  accountName: z.string().min(2, 'Account name is required').max(120),
});

export type WithdrawalAccountInput = z.infer<typeof withdrawalAccountSchema>;

export const withdrawalRequestSchema = z.object({
  amount: z.coerce.number().positive('Withdrawal amount must be greater than zero').max(100_000_000),
  accountId: z.string().optional(),
  vendorNote: z.string().max(500).optional(),
});

export const vendorWithdrawalListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PAID']).optional(),
});

export type WithdrawalRequestInput = z.infer<typeof withdrawalRequestSchema>;
export type VendorWithdrawalListInput = z.infer<typeof vendorWithdrawalListSchema>;
