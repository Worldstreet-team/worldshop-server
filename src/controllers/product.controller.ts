import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as productService from '../services/product.service';
import { productQuerySchema, featuredQuerySchema, relatedQuerySchema, searchQuerySchema } from '../validators/product.validator';
import { signProductRecord, signProductRecords } from '../utils/signUrl';

/**
 * GET /api/v1/products
 * Paginated product listing with filters.
 */
export const getProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const query = productQuerySchema.parse(req.query);
  const result = await productService.listProducts(query);
  result.data = await signProductRecords(result.data);

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * GET /api/v1/products/featured
 * Featured products for homepage carousels.
 */
export const getFeatured = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { limit } = featuredQuerySchema.parse(req.query);
  const products = await productService.getFeaturedProducts(limit);

  res.status(200).json({
    success: true,
    data: await signProductRecords(products),
  });
});

/**
 * GET /api/v1/products/search?q=...
 * Lightweight search endpoint.
 */
export const searchProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { q, limit } = searchQuerySchema.parse(req.query);
  const products = await productService.searchProducts(q, limit);

  res.status(200).json({
    success: true,
    data: await signProductRecords(products),
  });
});

/**
 * GET /api/v1/products/price-range
 * Returns min/max prices for filter UI.
 */
export const getPriceRange = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const range = await productService.getProductPriceRange();

  res.status(200).json({
    success: true,
    data: range,
  });
});

/**
 * GET /api/v1/products/brands
 * Returns distinct brand values for filter UI.
 */
export const getBrands = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const brands = await productService.getAllBrands();

  res.status(200).json({
    success: true,
    data: brands,
  });
});

/**
 * GET /api/v1/products/:slug
 * Single product by slug.
 */
export const getProductBySlug = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const slug = req.params.slug as string;
  const product = await productService.getProductBySlug(slug);

  if (!product) {
    return next(createError(404, 'Product not found'));
  }

  res.status(200).json({
    success: true,
    data: await signProductRecord(product),
  });
});

/**
 * GET /api/v1/products/id/:id
 * Single product by ID.
 */
export const getProductById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
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
 * GET /api/v1/products/:id/related
 * Related products for a given product.
 */
export const getRelatedProducts = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const { limit } = relatedQuerySchema.parse(req.query);
  const products = await productService.getRelatedProducts(id, limit);

  res.status(200).json({
    success: true,
    data: await signProductRecords(products),
  });
});
