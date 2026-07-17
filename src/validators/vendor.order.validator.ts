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
      'PACKAGED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED',
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
// Vendors drive fulfilment: PROCESSING → PACKAGED → SHIPPED (tracking number
// required) → OUT_FOR_DELIVERY → DELIVERED, plus DELIVERY_FAILED.
export const updateVendorOrderStatusSchema = z
  .object({
    status: z.enum([
      'PROCESSING',
      'PACKAGED',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED',
    ]),
    trackingNumber: z.string().min(3).max(100).optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'SHIPPED' && !data.trackingNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['trackingNumber'],
        message: 'A tracking number is required to mark an order as shipped',
      });
    }
  });

export type UpdateVendorOrderStatusInput = z.infer<typeof updateVendorOrderStatusSchema>;

// ─── Extend expected delivery date (delayed delivery) ───────────
export const extendDeliveryDateSchema = z.object({
  expectedDeliveryDate: z.coerce.date().refine((d) => d.getTime() > Date.now(), {
    message: 'The new expected delivery date must be in the future',
  }),
  note: z.string().max(500).optional(),
});

export type ExtendDeliveryDateInput = z.infer<typeof extendDeliveryDateSchema>;
