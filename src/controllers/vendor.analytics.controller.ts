import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as ledgerRead from '../services/ledger.read.service';

/**
 * GET /api/v1/vendor/analytics/summary
 * Dashboard summary: total sales, orders, revenue, commission for the vendor.
 */
export const getSummary = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const { from, to } = req.query as { from?: string; to?: string };

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
  const { type, from, to, page, limit, sort } = req.query as {
    type?: string;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
    sort?: 'asc' | 'desc';
  };

  const result = await ledgerRead.getVendorLedger(vendorId, {
    type,
    from,
    to,
    page: page ? parseInt(page, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
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
