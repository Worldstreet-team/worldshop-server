import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as adminOrderService from '../services/admin.order.service';
import {
  adminOrdersQuerySchema,
  updateOrderStatusSchema,
  orderStatsQuerySchema,
} from '../validators/admin.order.validator';

/**
 * GET /api/v1/admin/orders
 * List all orders (admin — no ownership filter).
 */
export const getOrders = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const query = adminOrdersQuerySchema.parse(req.query);
    const result = await adminOrderService.adminListOrders(query);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

/**
 * GET /api/v1/admin/orders/stats
 * Order statistics for admin dashboard.
 */
export const getOrderStats = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const query = orderStatsQuerySchema.parse(req.query);
    const stats = await adminOrderService.getOrderStats(query);

    res.status(200).json({
      success: true,
      data: stats,
    });
  }
);

/**
 * GET /api/v1/admin/orders/:id
 * Get a single order by ID (admin — no ownership check).
 */
export const getOrder = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const orderId = req.params.id as string;
    const order = await adminOrderService.adminGetOrder(orderId);

    res.status(200).json({
      success: true,
      data: order,
    });
  }
);

/**
 * PATCH /api/v1/admin/orders/:id/status
 * Update order status.
 */
export const updateOrderStatus = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const orderId = req.params.id as string;
    const adminId = req.user?.id || 'admin';
    const input = updateOrderStatusSchema.parse(req.body);
    const order = await adminOrderService.updateOrderStatus(orderId, input, adminId);

    res.status(200).json({
      success: true,
      data: order,
      message: `Order status updated to ${input.status}`,
    });
  }
);

/**
 * POST /api/v1/admin/orders/:id/resend-digital-delivery
 * Resend the digital delivery email for a specific order.
 */
export const resendDigitalDelivery = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const orderId = req.params.id as string;
    const result = await adminOrderService.resendDigitalDelivery(orderId);

    res.status(200).json({
      success: true,
      data: result,
      message: 'Digital delivery email sent',
    });
  }
);
