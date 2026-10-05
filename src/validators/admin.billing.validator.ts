import { z } from 'zod';

// Amounts are USD minor units (cents), as SubscriptionPlan stores them. The
// console converts from dollars before sending.
const planFields = {
  name: z.string().trim().min(2).max(60),
  amountMinor: z.number().int().min(0).max(10_000_000),
  // Monthly plans set intervalMonths; day-based plans leave it null and use
  // intervalDays. See addInterval in subscription.service.
  intervalMonths: z.number().int().min(1).max(24).nullable(),
  intervalDays: z.number().int().min(1).max(730),
  graceDays: z.number().int().min(0).max(60),
  listingLimit: z.number().int().min(1).max(100_000).nullable(),
  substoreLimit: z.number().int().min(1).max(1_000).nullable(),
  perks: z.array(z.string().trim().min(1).max(120)).max(12),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1_000),
};

export const adminPlanCreateSchema = z.object({
  // Code and kind are fixed at creation: subscriptions point at the plan by
  // id, but env vars (DEFAULT_PLAN_CODE) and the client pick plans by code.
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens'),
  kind: z.enum(['STORE', 'MALL']),
  ...planFields,
  perks: planFields.perks.default([]),
  isActive: planFields.isActive.default(true),
  sortOrder: planFields.sortOrder.default(0),
  intervalMonths: planFields.intervalMonths.default(1),
  intervalDays: planFields.intervalDays.default(30),
  graceDays: planFields.graceDays.default(7),
  listingLimit: planFields.listingLimit.default(null),
  substoreLimit: planFields.substoreLimit.default(null),
});

export const adminPlanUpdateSchema = z
  .object(planFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const adminRevenueQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});

export type AdminPlanCreateInput = z.infer<typeof adminPlanCreateSchema>;
export type AdminPlanUpdateInput = z.infer<typeof adminPlanUpdateSchema>;
export type AdminRevenueQuery = z.infer<typeof adminRevenueQuerySchema>;
