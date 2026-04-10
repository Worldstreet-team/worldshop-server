import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as storeService from '../services/store.service';
import { productQuerySchema } from '../validators/product.validator';
import { signProductRecords } from '../utils/signUrl';
import { enrichWithVendorInfo } from '../services/product.service';

/**
 * GET /api/v1/store/:slug
 * Public store page — vendor info + paginated products.
 */
export const getStore = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const slug = req.params.slug as string;
  const query = productQuerySchema.parse(req.query);

  const result = await storeService.getStoreBySlug(slug, query);

  if (!result) {
    throw createError(404, 'Store not found');
  }

  // Sign product image URLs and enrich with vendor info
  result.products.data = await enrichWithVendorInfo(await signProductRecords(result.products.data));

  res.status(200).json({
    success: true,
    store: result.store,
    ...result.products,
  });
});
