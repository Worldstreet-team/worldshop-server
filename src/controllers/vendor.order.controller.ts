import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as vendorOrderService from '../services/vendor.order.service';
import { sendOrderStatusUpdate } from '../services/email.service';
import prisma from '../configs/prismaConfig';
import {
  vendorOrdersQuerySchema,
  updateVendorOrderStatusSchema,
  extendDeliveryDateSchema,
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

  // Fire email notification to customer (non-blocking)
  const customer = await prisma.userProfile.findUnique({
    where: { userId: order.userId },
    select: { email: true, firstName: true, lastName: true },
  });
    if (customer?.email) {
      sendOrderStatusUpdate({
        customerEmail: customer.email,
        customerName: `${customer.firstName} ${customer.lastName}`,
        orderNumber: order.orderNumber,
        orderId: order.id,
        newStatus: input.status,
        note: input.note,
      }).catch((err) => {
        console.error('Failed to send order status email:', err);
      });
    }

  res.status(200).json({
    success: true,
    data: order,
    message: `Order status updated to ${input.status}.`,
  });
});

/**
 * PATCH /api/v1/vendor/orders/:id/delivery-date
 * Extend the expected delivery date on a delayed order. The buyer is emailed
 * so a delay never goes silently unannounced.
 */
export const extendDeliveryDate = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const vendorId = req.user!.id;
    const input = extendDeliveryDateSchema.parse(req.body);
    const order = await vendorOrderService.extendVendorDeliveryDate(
      req.params.id as string,
      vendorId,
      input,
    );

    const customer = await prisma.userProfile.findUnique({
      where: { userId: order.userId },
      select: { email: true, firstName: true, lastName: true },
    });
    if (customer?.email) {
      sendOrderStatusUpdate({
        customerEmail: customer.email,
        customerName: `${customer.firstName} ${customer.lastName}`,
        orderNumber: order.orderNumber,
        orderId: order.id,
        newStatus: order.status,
        note: `Your delivery has been rescheduled — new expected date: ${
          order.expectedDeliveryDate
            ? new Date(order.expectedDeliveryDate).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })
            : 'to be confirmed'
        }${input.note ? `. ${input.note}` : ''}`,
      }).catch((err) => {
        console.error('Failed to send delivery-date email:', err);
      });
    }

    res.status(200).json({
      success: true,
      data: order,
      message: 'Expected delivery date updated.',
    });
  },
);
