import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as adminCategoryService from '../services/admin.category.service';
import {
  createCategorySchema,
  updateCategorySchema,
  adminCategoryQuerySchema,
  createAttributeSchema,
  updateAttributeSchema,
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
  const result = await adminCategoryService.deleteCategory(id, moveProductsTo);

  const notes: string[] = [];
  if (result.deactivatedChildren) {
    notes.push(`${result.deactivatedChildren} subcategor${result.deactivatedChildren === 1 ? 'y was' : 'ies were'} deactivated with it`);
  }
  if (result.listingsNeedingRefile) {
    notes.push(`${result.listingsNeedingRefile} listing(s) need re-filing before they can be republished`);
  }

  res.status(200).json({
    success: true,
    data: result,
    message: ['Category deactivated.', ...notes].join(' '),
  });
});

// ─── Category attributes ────────────────────────────────────────
// The structured layer vendors fill in and buyers filter on. Only leaf
// categories have them, because only leaves hold listings.

/** GET /api/v1/admin/categories/tree */
export const getTree = catchAsync(async (req: Request, res: Response) => {
  const { includeInactive } = adminCategoryQuerySchema.parse(req.query);
  const tree = await adminCategoryService.adminCategoryTree(includeInactive);

  res.status(200).json({ success: true, data: tree });
});

/** GET /api/v1/admin/categories/:id/attributes */
export const getAttributes = catchAsync(async (req: Request, res: Response) => {
  const attributes = await adminCategoryService.listAttributes(req.params.id as string);
  res.status(200).json({ success: true, data: attributes });
});

/** POST /api/v1/admin/categories/:id/attributes */
export const createAttribute = catchAsync(async (req: Request, res: Response) => {
  const data = createAttributeSchema.parse(req.body);
  const attribute = await adminCategoryService.createAttribute(req.params.id as string, data);

  res.status(201).json({ success: true, data: attribute, message: 'Attribute added.' });
});

/**
 * PATCH /api/v1/admin/categories/:id/attributes/:attributeId
 * Reports how many existing listings the change invalidates — tightening
 * standards is allowed, but the admin should see the blast radius.
 */
export const updateAttribute = catchAsync(async (req: Request, res: Response) => {
  const data = updateAttributeSchema.parse(req.body);
  const result = await adminCategoryService.updateAttribute(
    req.params.id as string,
    req.params.attributeId as string,
    data,
  );

  res.status(200).json({
    success: true,
    data: result.attribute,
    message: result.listingsNowInvalid
      ? `Attribute updated. ${result.listingsNowInvalid} existing listing(s) no longer meet this rule and cannot be republished until fixed.`
      : 'Attribute updated.',
  });
});

/** DELETE /api/v1/admin/categories/:id/attributes/:attributeId?force=true */
export const deleteAttribute = catchAsync(async (req: Request, res: Response) => {
  const result = await adminCategoryService.deleteAttribute(
    req.params.id as string,
    req.params.attributeId as string,
    req.query.force === 'true',
  );

  res.status(200).json({
    success: true,
    data: result,
    message: result.listingsCleared
      ? `Removed "${result.deleted}" and cleared it from ${result.listingsCleared} listing(s).`
      : `Removed "${result.deleted}".`,
  });
});

/** PUT /api/v1/admin/categories/:id/attributes/order */
export const reorderAttributes = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { orderedIds } = req.body as { orderedIds?: unknown };
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
    return next(createError(400, 'orderedIds must be an array of attribute ids'));
  }

  const attributes = await adminCategoryService.reorderAttributes(
    req.params.id as string,
    orderedIds as string[],
  );

  res.status(200).json({ success: true, data: attributes, message: 'Order updated.' });
});
