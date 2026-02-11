import { Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import * as adminInventoryService from '../services/admin.inventory.service';
import {
  inventoryQuerySchema,
  adjustStockSchema,
  updateThresholdSchema,
} from '../validators/admin.inventory.validator';

/**
 * GET /admin/inventory
 */
export const getInventory = catchAsync(async (req: Request, res: Response) => {
  const query = inventoryQuerySchema.parse(req.query);
  const result = await adminInventoryService.listInventory(query);

  res.json({
    success: true,
    message: 'Inventory retrieved successfully',
    ...result,
  });
});

/**
 * GET /admin/inventory/stats
 */
export const getInventoryStats = catchAsync(async (_req: Request, res: Response) => {
  const stats = await adminInventoryService.getInventoryStats();

  res.json({
    success: true,
    message: 'Inventory stats retrieved successfully',
    data: stats,
  });
});

/**
 * GET /admin/inventory/low-stock
 */
export const getLowStockAlerts = catchAsync(async (_req: Request, res: Response) => {
  const alerts = await adminInventoryService.getLowStockAlerts();

  res.json({
    success: true,
    message: 'Low stock alerts retrieved successfully',
    data: alerts,
  });
});

/**
 * PATCH /admin/inventory/:id/adjust
 */
export const adjustStock = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const input = adjustStockSchema.parse(req.body);
  const result = await adminInventoryService.adjustStock(id, input);

  res.json({
    success: true,
    message: 'Stock adjusted successfully',
    data: result,
  });
});

/**
 * PATCH /admin/inventory/:id/threshold
 */
export const updateThreshold = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const input = updateThresholdSchema.parse(req.body);
  const result = await adminInventoryService.updateThreshold(id, input);

  res.json({
    success: true,
    message: 'Low stock threshold updated successfully',
    data: result,
  });
});
