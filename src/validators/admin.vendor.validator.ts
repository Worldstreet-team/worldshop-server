import { z } from 'zod';

export const adminVendorListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']).optional(),
  search: z.string().max(100).optional(),
  sortBy: z.enum(['newest', 'oldest', 'name_asc', 'name_desc']).default('newest'),
});

export const adminVendorStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
});

export const adminVendorProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminCommissionRateSchema = z.object({
  rate: z.number().min(0, 'Rate must be at least 0').max(1, 'Rate must be at most 1'),
});

export const adminWithdrawalListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PAID']).optional(),
  vendorId: z.string().optional(),
});

export const adminWithdrawalStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'PAID']),
  adminNote: z.string().max(500).optional(),
});

export type AdminVendorListInput = z.infer<typeof adminVendorListSchema>;
export type AdminVendorStatusInput = z.infer<typeof adminVendorStatusSchema>;
export type AdminVendorProductsInput = z.infer<typeof adminVendorProductsSchema>;
export type AdminCommissionRateInput = z.infer<typeof adminCommissionRateSchema>;
export type AdminWithdrawalListInput = z.infer<typeof adminWithdrawalListSchema>;
export type AdminWithdrawalStatusInput = z.infer<typeof adminWithdrawalStatusSchema>;
