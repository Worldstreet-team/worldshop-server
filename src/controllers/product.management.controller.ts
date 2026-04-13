import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import { ProductService, getDashboardStats as fetchDashboardStats } from '../services/product.management.service';
import type { ProductContext } from '../services/product.management.service';
import {
  adminCreateProductSchema,
  adminUpdateProductSchema,
  vendorCreateProductSchema,
  vendorUpdateProductSchema,
  productListQuerySchema,
  toggleProductSchema,
} from '../validators/product.management.validator';
import { signProductRecord, signProductRecords } from '../utils/signUrl';

// ─── Context Builder ────────────────────────────────────────────

function buildAdminContext(req: Request): ProductContext {
  return { role: 'admin', userId: req.user!.id };
}

function buildVendorContext(req: Request): ProductContext {
  return { role: 'vendor', userId: req.user!.id, vendorId: req.user!.id };
}

// ─── Admin Product Handlers ─────────────────────────────────────

export const adminListProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildAdminContext(req));
  const query = productListQuerySchema.parse(req.query);
  const result = await service.list(query);
  result.data = await signProductRecords(result.data);

  res.status(200).json({ success: true, ...result });
});

export const adminGetProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildAdminContext(req));
  const product = await service.get(req.params.id as string);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
  });
});

export const adminCreateProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildAdminContext(req));
  const data = adminCreateProductSchema.parse(req.body);
  const product = await service.create(data);

  res.status(201).json({
    success: true,
    data: await signProductRecord(product),
    message: 'Product created successfully.',
  });
});

export const adminUpdateProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildAdminContext(req));
  const data = adminUpdateProductSchema.parse(req.body);
  const product = await service.update(req.params.id as string, data);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
    message: 'Product updated successfully.',
  });
});

export const adminDeleteProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildAdminContext(req));
  await service.delete(req.params.id as string);

  res.status(200).json({
    success: true,
    message: 'Product deactivated successfully.',
  });
});

export const getDashboardStats = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 15));
  const stats = await fetchDashboardStats(page, limit);

  res.status(200).json({ success: true, data: stats });
});

// ─── Vendor Product Handlers ────────────────────────────────────

export const vendorListProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildVendorContext(req));
  const query = productListQuerySchema.parse(req.query);
  const result = await service.list(query);
  result.data = await signProductRecords(result.data);

  res.status(200).json({ success: true, ...result });
});

export const vendorGetProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildVendorContext(req));
  const product = await service.get(req.params.id as string);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
  });
});

export const vendorCreateProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildVendorContext(req));
  const data = vendorCreateProductSchema.parse(req.body);
  const product = await service.create(data);

  res.status(201).json({
    success: true,
    data: await signProductRecord(product),
    message: 'Product created successfully.',
  });
});

export const vendorUpdateProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildVendorContext(req));
  const data = vendorUpdateProductSchema.parse(req.body);
  const product = await service.update(req.params.id as string, data);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
    message: 'Product updated successfully.',
  });
});

export const vendorDeleteProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildVendorContext(req));
  await service.delete(req.params.id as string);

  res.status(200).json({
    success: true,
    message: 'Product deactivated successfully.',
  });
});

export const vendorToggleProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const service = new ProductService(buildVendorContext(req));
  const { isActive } = toggleProductSchema.parse(req.body);
  const product = await service.toggle(req.params.id as string, isActive);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
    message: `Product ${isActive ? 'activated' : 'deactivated'} successfully.`,
  });
});
