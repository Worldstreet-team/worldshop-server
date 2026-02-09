import { z } from 'zod';

// ─── Add to cart ────────────────────────────────────────────────
export const addToCartSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;

// ─── Update cart item ───────────────────────────────────────────
export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

// ─── Merge cart (after login) ───────────────────────────────────
export const mergeCartSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
});

export type MergeCartInput = z.infer<typeof mergeCartSchema>;
