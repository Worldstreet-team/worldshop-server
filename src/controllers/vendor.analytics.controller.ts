import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as ledgerRead from '../services/ledger.read.service';
import { z } from 'zod';

const analyticsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const earningsQuerySchema = z.object({
  type: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['asc', 'desc']).optional(),
});

/**
 * GET /api/v1/vendor/analytics/summary
 * Dashboard summary: total sales, orders, revenue, commission for the vendor.
 */
export const getSummary = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const { from, to } = analyticsQuerySchema.parse(req.query);

  const analytics = await ledgerRead.getVendorAnalytics({ vendorId, from, to });

  res.status(200).json({
    success: true,
    data: analytics,
  });
});

/**
 * GET /api/v1/vendor/analytics/earnings
 * Earnings data over time with filtering.
 */
export const getEarnings = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const { type, from, to, page, limit, sort } = earningsQuerySchema.parse(req.query);

  const result = await ledgerRead.getVendorLedger(vendorId, {
    type,
    from,
    to,
    page,
    limit,
    sort,
  });

  res.status(200).json({
    success: true,
    data: result.entries,
    total: result.total,
  });
});

/**
 * GET /api/v1/vendor/balance
 * Current wallet balance for the vendor.
 */
export const getBalance = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const balance = await ledgerRead.getVendorBalance(vendorId);

  res.status(200).json({
    success: true,
    data: balance,
  });
});
