import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as checkoutService from '../services/checkout.service';
import * as paymentService from '../services/payment.service';

/**
 * POST /api/v1/checkout/validate
 * Validate cart before checkout (check stock, calculate totals).
 */
export const validateCart = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for checkout',
      });
    }

    const result = await checkoutService.validateCart(userId);

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);

/**
 * POST /api/v1/checkout/session/preview
 * Preview checkout session — returns vendor groups, issues, and snapshot token.
 */
export const previewCheckoutSession = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for checkout',
      });
    }

    const preview = await checkoutService.previewCheckoutSession(userId);

    res.status(200).json({
      success: true,
      data: preview,
    });
  },
);

/**
 * POST /api/v1/checkout/session
 * Confirm checkout session — creates orders atomically.
 */
export const confirmCheckoutSession = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for checkout',
      });
    }

    try {
      const result = await checkoutService.confirmCheckoutSession(
        userId,
        req.body,
      );

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      if (err.status === 409 && err.preview) {
        return res.status(409).json({
          success: false,
          message: err.message,
          data: err.preview,
        });
      }
      throw err;
    }
  },
);

/**
 * POST /api/v1/checkout/pay
 * Initialize payment for a checkout session.
 */
export const initializePayment = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId || !userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required for payment',
      });
    }

    const { checkoutSessionId } = req.body;

    if (!checkoutSessionId) {
      return res.status(400).json({
        success: false,
        message: 'checkoutSessionId is required',
      });
    }

    const result = await paymentService.initializePayment(
      userId,
      userEmail,
      checkoutSessionId,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  },
);
