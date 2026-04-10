import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as vendorOrderService from '../services/vendor.order.service';
import {
  vendorOrdersQuerySchema,
  updateVendorOrderStatusSchema,
} from '../validators/vendor.order.validator';

/**
 * GET /api/v1/vendor/orders
 * Paginated listing of orders belonging to the authenticated vendor.
 */
export const getOrders = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const query = vendorOrdersQuerySchema.parse(req.query);
  const result = await vendorOrderService.getVendorOrders(vendorId, query);

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * GET /api/v1/vendor/orders/:id
 * Single order detail (must belong to vendor).
 */
export const getOrder = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const order = await vendorOrderService.getVendorOrder(req.params.id as string, vendorId);

  res.status(200).json({
    success: true,
    data: order,
  });
});

/**
 * PATCH /api/v1/vendor/orders/:id/status
 * Update order status (restricted transitions: PAID → PROCESSING → DELIVERED).
 */
export const updateStatus = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const input = updateVendorOrderStatusSchema.parse(req.body);
  const order = await vendorOrderService.updateVendorOrderStatus(req.params.id as string, vendorId, input);

  res.status(200).json({
    success: true,
    data: order,
    message: `Order status updated to ${input.status}.`,
  });
});
