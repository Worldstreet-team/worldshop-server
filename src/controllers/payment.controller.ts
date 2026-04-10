import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as paymentService from '../services/payment.service';

/**
 * GET /api/v1/payments/verify/:ref
 * Verify a payment by transaction reference.
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

    const transactionRef = req.params.ref as string;
    const result = await paymentService.verifyPayment(userId, transactionRef);

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

/**
 * POST /api/v1/payments/webhook
 * Handle mock payment webhook (confirm/decline).
 * No authentication — called by the mock payment page.
 */
export const webhook = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const rawBody = JSON.stringify(req.body);
    const signature = (req.headers['x-webhook-signature'] as string) || '';

    const result = await paymentService.handleWebhook(rawBody, signature);

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);
