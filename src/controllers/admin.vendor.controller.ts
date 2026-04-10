import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as adminVendorService from '../services/admin.vendor.service';
import * as ledgerReadService from '../services/ledger.read.service';
import {
  adminVendorListSchema,
  adminVendorStatusSchema,
  adminVendorProductsSchema,
  adminCommissionRateSchema,
} from '../validators/admin.vendor.validator';
import { signProductRecords } from '../utils/signUrl';

// ─── Vendor List ────────────────────────────────────────────────

/**
 * GET /api/v1/admin/vendors
 */
export const listVendors = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const query = adminVendorListSchema.parse(req.query);
  const result = await adminVendorService.listVendors(query);

  res.status(200).json({ success: true, ...result });
});

// ─── Vendor Detail ──────────────────────────────────────────────

/**
 * GET /api/v1/admin/vendors/:id
 */
export const getVendor = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const result = await adminVendorService.getVendorDetail(req.params.id as string);

  res.status(200).json({ success: true, data: result });
});

// ─── Vendor Status ──────────────────────────────────────────────

/**
 * PATCH /api/v1/admin/vendors/:id/status
 */
export const updateVendorStatus = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { status } = adminVendorStatusSchema.parse(req.body);
  const result = await adminVendorService.updateVendorStatus(req.params.id as string, status);

  res.status(200).json({
    success: true,
    data: result,
    message: `Vendor status updated to ${status}.`,
  });
});

// ─── Vendor Products (for admin review) ─────────────────────────

/**
 * GET /api/v1/admin/vendors/:id/products
 */
export const getVendorProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  // First get the vendor to find their userId
  const vendor = await adminVendorService.getVendorDetail(req.params.id as string);
  const query = adminVendorProductsSchema.parse(req.query);
  const result = await adminVendorService.getVendorProducts(vendor.userId, query);
  result.data = await signProductRecords(result.data as any) as any;

  res.status(200).json({ success: true, ...result });
});

// ─── Commission Report ──────────────────────────────────────────

/**
 * GET /api/v1/admin/reports/commission
 */
export const getCommissionReport = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const result = await ledgerReadService.getCommissionReport({ from, to });

  res.status(200).json({ success: true, data: result });
});

// ─── Commission Settings ────────────────────────────────────────

/**
 * GET /api/v1/admin/settings/commission
 */
export const getCommissionRate = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const result = await adminVendorService.getCommissionRate();

  res.status(200).json({ success: true, data: result });
});

/**
 * PATCH /api/v1/admin/settings/commission
 */
export const updateCommissionRate = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { rate } = adminCommissionRateSchema.parse(req.body);
  const result = await adminVendorService.updateCommissionRate(rate);

  res.status(200).json({
    success: true,
    data: result,
    message: `Commission rate updated to ${(rate * 100).toFixed(1)}%. This affects future orders only.`,
  });
});
