import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as categoryService from '../services/category.service';
import { categorySlugQuerySchema } from '../validators/category.validator';
import { featuredQuerySchema } from '../validators/product.validator';

/**
 * GET /api/v1/categories
 * All active categories (flat list with product count).
 */
export const getCategories = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const categories = await categoryService.getAllCategories();

  res.status(200).json({
    success: true,
    data: categories,
  });
});

/**
 * GET /api/v1/categories/featured
 * Categories for homepage display (with product count).
 */
export const getFeaturedCategories = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { limit } = featuredQuerySchema.parse(req.query);
  const categories = await categoryService.getFeaturedCategories(limit);

  res.status(200).json({
    success: true,
    data: categories,
  });
});

/**
 * GET /api/v1/categories/id/:id
 * Single category by ID.
 */
export const getCategoryById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const category = await categoryService.getCategoryById(id);

  if (!category) {
    return next(createError(404, 'Category not found'));
  }

  res.status(200).json({
    success: true,
    data: category,
  });
});

/**
 * GET /api/v1/categories/:slug
 * Category by slug with paginated products.
 */
export const getCategoryBySlug = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const slug = req.params.slug as string;
  const query = categorySlugQuerySchema.parse(req.query);
  const result = await categoryService.getCategoryBySlug(slug, query);

  if (!result) {
    return next(createError(404, 'Category not found'));
  }

  res.status(200).json({
    success: true,
    data: result,
  });
});
