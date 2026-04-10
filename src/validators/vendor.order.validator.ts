import { z } from 'zod';

// ─── Vendor order listing query ─────────────────────────────────
export const vendorOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum([
      'CREATED',
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  sortBy: z
    .enum(['newest', 'oldest', 'total_asc', 'total_desc'])
    .default('newest'),
});

export type VendorOrdersQueryInput = z.infer<typeof vendorOrdersQuerySchema>;

// ─── Update vendor order status ─────────────────────────────────
// Vendors can only set PROCESSING or DELIVERED
export const updateVendorOrderStatusSchema = z.object({
  status: z.enum(['PROCESSING', 'DELIVERED']),
  note: z.string().max(500).optional(),
});

export type UpdateVendorOrderStatusInput = z.infer<typeof updateVendorOrderStatusSchema>;
