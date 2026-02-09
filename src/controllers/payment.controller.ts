import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as paymentService from '../services/payment.service';
import { initializePaymentSchema } from '../validators/payment.validator';
import { verifyWebhookSignature } from '../configs/paystackConfig';
import type { PaystackWebhookEvent } from '../types/payment.types';

/**
 * POST /api/v1/payments/initialize
 * Initialize a Paystack payment for an order.
 * Requires authentication.
 */
export const initialize = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId || !userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to initialize payment',
      });
    }

    const { orderId } = initializePaymentSchema.parse(req.body);
    const result = await paymentService.initializePayment(
      userId,
      userEmail,
      orderId
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * GET /api/v1/payments/verify/:reference
 * Verify a payment by Paystack reference.
 * Requires authentication.
 */
export const verify = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const reference = req.params.reference as string;
    const result = await paymentService.verifyPayment(userId, reference);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * POST /api/v1/payments/webhook
 * Handle Paystack webhook events.
 * NO authentication — verified via HMAC SHA-512 signature.
 */
export const webhook = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const signature = req.headers['x-paystack-signature'] as string;

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing webhook signature',
      });
    }

    // Verify HMAC signature
    const body = JSON.stringify(req.body);
    const isValid = verifyWebhookSignature(body, signature);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature',
      });
    }

    const event = req.body as PaystackWebhookEvent;
    await paymentService.handleWebhook(event);

    // Paystack expects a 200 response
    res.status(200).json({ success: true });
  }
);
