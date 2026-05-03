import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as paymentService from '../services/payment.service';

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

export const mockWebhook = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const rawBody = JSON.stringify(req.body);
    const signature = (req.headers['x-webhook-signature'] as string) || '';

    const result = await paymentService.handleWebhook(rawBody, signature, 'MOCK');

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

export const flutterwaveWebhook = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const rawBody = JSON.stringify(req.body);
    const signature = (req.headers['flutterwave-signature'] as string) || '';

    const result = await paymentService.handleWebhook(rawBody, signature, 'FLUTTERWAVE');

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

export const webhook = mockWebhook;
