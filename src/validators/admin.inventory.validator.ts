import { z } from 'zod';

// ─── Inventory listing query ────────────────────────────────────
export const inventoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  stock: z.enum(['in-stock', 'low-stock', 'out-of-stock', 'all']).default('all'),
  categoryId: z.string().optional(),
  sortBy: z
    .enum(['name_asc', 'name_desc', 'stock_asc', 'stock_desc', 'newest', 'oldest'])
    .default('stock_asc'),
});

export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>;

// ─── Stock adjustment ───────────────────────────────────────────
export const adjustStockSchema = z.object({
  adjustment: z.number().int(),
  reason: z.string().min(1, 'Reason is required').max(500),
  variantId: z.string().optional(),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

// ─── Update low stock threshold ─────────────────────────────────
export const updateThresholdSchema = z.object({
  lowStockThreshold: z.number().int().min(0).max(10000),
});

export type UpdateThresholdInput = z.infer<typeof updateThresholdSchema>;
