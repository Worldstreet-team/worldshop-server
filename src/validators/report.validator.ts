import { z } from 'zod';

/**
 * Reasons are a fixed list rather than free text: the queue is ranked and
 * filtered by them, and "scam" written eleven different ways cannot be counted.
 * `details` is where the reporter explains.
 */
export const REPORT_REASONS = [
  'SCAM',
  'PROHIBITED',      // illegal or banned goods
  'MISLEADING',      // wrong photos, fake specs, bait pricing
  'MISCATEGORISED',
  'DUPLICATE',
  'OFFENSIVE',
  'FAKE_REVIEW',
  'OTHER',
] as const;

export const createReportSchema = z.object({
  targetType: z.enum(['LISTING', 'STORE', 'MALL', 'REVIEW']),
  targetId: z.string().length(24, 'A valid targetId is required'),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const REPORT_ACTIONS = [
  'REMOVE_LISTING',
  'SUSPEND_STORE',
  'BAN_STORE',
  'SUSPEND_MALL',
  'BAN_MALL',
  'REMOVE_REVIEW',
] as const;

export type ReportAction = (typeof REPORT_ACTIONS)[number];

export const actionReportSchema = z.object({
  action: z.enum(REPORT_ACTIONS),
  // Recorded on every report closed by this decision — the audit trail for why
  // a store was taken off the marketplace.
  note: z.string().trim().max(500).optional(),
});

export type ActionReportInput = z.infer<typeof actionReportSchema>;

export const dismissReportSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED']).optional(),
  targetType: z.enum(['LISTING', 'STORE', 'MALL', 'REVIEW']).optional(),
  reason: z.enum(REPORT_REASONS).optional(),
});

export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

export const queueQuerySchema = z.object({
  targetType: z.enum(['LISTING', 'STORE', 'MALL', 'REVIEW']).optional(),
});
