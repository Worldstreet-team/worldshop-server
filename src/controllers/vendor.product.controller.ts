import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as vendorProductService from '../services/vendor.product.service';
import {
  vendorCreateProductSchema,
  vendorUpdateProductSchema,
  vendorProductQuerySchema,
  vendorToggleProductSchema,
} from '../validators/vendor.product.validator';
import { signProductRecord, signProductRecords } from '../utils/signUrl';

/**
 * GET /api/v1/vendor/products
 * Paginated listing of authenticated vendor's products.
 */
export const getProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const query = vendorProductQuerySchema.parse(req.query);
  const result = await vendorProductService.vendorListProducts(vendorId, query);
  result.data = await signProductRecords(result.data);

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * GET /api/v1/vendor/products/:id
 * Single product by ID (must belong to vendor).
 */
export const getProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const product = await vendorProductService.vendorGetProduct(vendorId, req.params.id as string);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
  });
});

/**
 * POST /api/v1/vendor/products
 * Create a new digital product.
 */
export const createProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const data = vendorCreateProductSchema.parse(req.body);
  const product = await vendorProductService.vendorCreateProduct(vendorId, data);

  res.status(201).json({
    success: true,
    data: await signProductRecord(product),
    message: 'Product created successfully.',
  });
});

/**
 * PUT /api/v1/vendor/products/:id
 * Update an existing product (must belong to vendor).
 */
export const updateProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const data = vendorUpdateProductSchema.parse(req.body);
  const product = await vendorProductService.vendorUpdateProduct(vendorId, req.params.id as string, data);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product!),
    message: 'Product updated successfully.',
  });
});

/**
 * DELETE /api/v1/vendor/products/:id
 * Soft-delete a product (must belong to vendor).
 */
export const deleteProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  await vendorProductService.vendorDeleteProduct(vendorId, req.params.id as string);

  res.status(200).json({
    success: true,
    message: 'Product deactivated successfully.',
  });
});

/**
 * PATCH /api/v1/vendor/products/:id/toggle
 * Toggle isActive for a vendor's product.
 */
export const toggleProduct = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const { isActive } = vendorToggleProductSchema.parse(req.body);
  const product = await vendorProductService.vendorToggleProduct(vendorId, req.params.id as string, isActive);

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
    message: `Product ${isActive ? 'activated' : 'deactivated'} successfully.`,
  });
});
