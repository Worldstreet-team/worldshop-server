import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as orderService from '../services/order.service';
import {
  createOrderSchema,
  ordersQuerySchema,
  cancelOrderSchema,
} from '../validators/order.validator';

/**
 * POST /api/v1/orders
 * Create order from cart.
 * Requires authentication.
 */
export const createOrder = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to create order',
      });
    }

    const input = createOrderSchema.parse(req.body);
    const order = await orderService.createOrder(userId, input);

    res.status(201).json({
      success: true,
      data: order,
    });
  }
);

/**
 * GET /api/v1/orders
 * Get user's orders with pagination.
 * Requires authentication.
 */
export const getOrders = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const query = ordersQuerySchema.parse(req.query);
    const result = await orderService.getOrders(userId, query);

    res.status(200).json({
      success: true,
      ...result,
    });
  }
);

/**
 * GET /api/v1/orders/:id
 * Get single order by ID.
 * Requires authentication.
 */
export const getOrderById = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const orderId = req.params.id as string;
    const order = await orderService.getOrderById(orderId, userId);

    res.status(200).json({
      success: true,
      data: order,
    });
  }
);

/**
 * GET /api/v1/orders/number/:orderNumber
 * Get single order by order number.
 * Requires authentication.
 */
export const getOrderByNumber = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const orderNumber = req.params.orderNumber as string;
    const order = await orderService.getOrderByNumber(orderNumber, userId);

    res.status(200).json({
      success: true,
      data: order,
    });
  }
);

/**
 * POST /api/v1/orders/:id/cancel
 * Cancel an order.
 * Requires authentication.
 */
export const cancelOrder = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const orderId = req.params.id as string;
    const input = cancelOrderSchema.parse(req.body);
    const order = await orderService.cancelOrder(orderId, userId, input);

    res.status(200).json({
      success: true,
      data: order,
    });
  }
);
