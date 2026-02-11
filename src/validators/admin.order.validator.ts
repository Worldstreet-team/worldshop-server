import { z } from 'zod';

// ─── Admin order listing query ──────────────────────────────────
export const adminOrdersQuerySchema = z.object({
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
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z
    .enum([
      'newest',
      'oldest',
      'total_asc',
      'total_desc',
    ])
    .default('newest'),
});

export type AdminOrdersQueryInput = z.infer<typeof adminOrdersQuerySchema>;

// ─── Update order status ────────────────────────────────────────
export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'PAID',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'REFUNDED',
  ]),
  note: z.string().max(500).optional(),
  trackingNumber: z.string().max(100).optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

// ─── Admin order stats query ────────────────────────────────────
export const orderStatsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '12m', 'all']).default('30d'),
});

export type OrderStatsQueryInput = z.infer<typeof orderStatsQuerySchema>;
