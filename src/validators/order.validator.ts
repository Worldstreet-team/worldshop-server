import { z } from 'zod';

// ─── Shipping address schema ────────────────────────────────────
export const shippingAddressSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().min(1, 'Phone is required').max(20),
  street: z.string().min(1, 'Street address is required').max(200),
  apartment: z.string().max(100).optional(),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  country: z.string().min(1, 'Country is required').max(100).default('Nigeria'),
  postalCode: z.string().max(20).optional().default(''),
});

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;

// ─── Create order from checkout ─────────────────────────────────
export const createOrderSchema = z.object({
  shippingAddress: shippingAddressSchema,
  billingAddress: shippingAddressSchema.optional(),
  notes: z.string().max(500).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ─── Orders query params ────────────────────────────────────────
export const ordersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(['CREATED', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED']).optional(),
});

export type OrdersQueryInput = z.infer<typeof ordersQuerySchema>;

// ─── Cancel order ───────────────────────────────────────────────
export const cancelOrderSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
