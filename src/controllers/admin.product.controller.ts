import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as adminProductService from '../services/admin.product.service';
import * as productService from '../services/product.service';
import {
  createProductSchema,
  updateProductSchema,
  adminProductQuerySchema,
} from '../validators/admin.product.validator';
import { signProductRecord, signProductRecords } from '../utils/signUrl';

/**
 * GET /api/v1/admin/products
 * Admin product listing (includes inactive products).
 */
export const getProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const query = adminProductQuerySchema.parse(req.query);
  const result = await adminProductService.adminListProducts(query);
  result.data = await signProductRecords(result.data);

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * GET /api/v1/admin/products/:id
 * Single product by ID (includes inactive).
 */
export const getProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const product = await productService.getProductById(id);

  if (!product) {
    return next(createError(404, 'Product not found'));
  }

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
  });
});

/**
 * POST /api/v1/admin/products
 * Create a new product.
 */
export const createProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const data = createProductSchema.parse(req.body);
  const product = await adminProductService.createProduct(data);

  res.status(201).json({
    success: true,
    data: await signProductRecord(product),
    message: 'Product created successfully.',
  });
});

/**
 * PUT /api/v1/admin/products/:id
 * Update an existing product.
 */
export const updateProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const existing = await productService.getProductById(id);
  if (!existing) {
    return next(createError(404, 'Product not found'));
  }

  const data = updateProductSchema.parse(req.body);
  const product = await adminProductService.updateProduct(id, data);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product!),
    message: 'Product updated successfully.',
  });
});

/**
 * DELETE /api/v1/admin/products/:id
 * Soft-delete a product (sets isActive = false).
 */
export const deleteProduct = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const existing = await productService.getProductById(id);
  if (!existing) {
    return next(createError(404, 'Product not found'));
  }

  await adminProductService.deleteProduct(id);

  res.status(200).json({
    success: true,
    message: 'Product deactivated successfully.',
  });
});

/**
 * GET /api/v1/admin/dashboard/stats
 * Dashboard overview statistics.
 */
export const getDashboardStats = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const stats = await adminProductService.getDashboardStats();

  res.status(200).json({
    success: true,
    data: stats,
  });
});
