import { Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import * as paymentService from '../services/payment.service';
import { getUsdNgnRate, ngnToUsdMinor } from '../services/payment/providers/wallet.provider';

/**
 * GET /api/v1/payments/wallet/quote?amountNgn=25000
 * Quote the USD amount a wallet payment would charge for an NGN total.
 * Uses the same cached rate the WALLET provider charges with, so a quote
 * shown to the buyer matches the charge that follows within the cache TTL.
 */
export const walletQuote = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const amountNgn = Number(req.query.amountNgn);
    if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
      throw createError(400, 'amountNgn must be a positive number');
    }

    const fxRate = await getUsdNgnRate();
    const usdMinor = ngnToUsdMinor(amountNgn, fxRate);

    res.status(200).json({
      success: true,
      data: {
        amountNgn,
        fxRate,
        usdMinor,
        usd: usdMinor / 100,
      },
    });
  },
);

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
    const rawBody =
      (req as Request & { rawBody?: string }).rawBody ??
      JSON.stringify(req.body);
    const signature = (req.headers['flutterwave-signature'] as string) || '';

    const result = await paymentService.handleWebhook(rawBody, signature, 'FLUTTERWAVE');

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

export const webhook = mockWebhook;
