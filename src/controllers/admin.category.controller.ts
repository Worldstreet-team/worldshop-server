import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as adminCategoryService from '../services/admin.category.service';
import {
  createCategorySchema,
  updateCategorySchema,
  adminCategoryQuerySchema,
} from '../validators/admin.category.validator';

/**
 * GET /api/v1/admin/categories
 * All categories including inactive (admin view).
 */
export const getCategories = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { includeInactive } = adminCategoryQuerySchema.parse(req.query);
  const categories = await adminCategoryService.adminListCategories(includeInactive);

  res.status(200).json({
    success: true,
    data: categories,
  });
});

/**
 * GET /api/v1/admin/categories/:id
 * Single category by ID (admin view).
 */
export const getCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const category = await adminCategoryService.getCategoryById(id);

  if (!category) {
    return next(createError(404, 'Category not found'));
  }

  res.status(200).json({
    success: true,
    data: category,
  });
});

/**
 * POST /api/v1/admin/categories
 * Create a new category.
 */
export const createCategory = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const data = createCategorySchema.parse(req.body);
  const category = await adminCategoryService.createCategory(data);

  res.status(201).json({
    success: true,
    data: category,
    message: 'Category created successfully.',
  });
});

/**
 * PUT /api/v1/admin/categories/:id
 * Update an existing category.
 */
export const updateCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const existing = await adminCategoryService.getCategoryById(id);
  if (!existing) {
    return next(createError(404, 'Category not found'));
  }

  const data = updateCategorySchema.parse(req.body);
  const category = await adminCategoryService.updateCategory(id, data);

  res.status(200).json({
    success: true,
    data: category,
    message: 'Category updated successfully.',
  });
});

/**
 * DELETE /api/v1/admin/categories/:id
 * Soft-delete a category. Optionally move products to another category.
 */
export const deleteCategory = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const existing = await adminCategoryService.getCategoryById(id);
  if (!existing) {
    return next(createError(404, 'Category not found'));
  }

  const { moveProductsTo } = req.body as { moveProductsTo?: string };
  await adminCategoryService.deleteCategory(id, moveProductsTo);

  res.status(200).json({
    success: true,
    message: 'Category deactivated successfully.',
  });
});
