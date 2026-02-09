import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as checkoutService from '../services/checkout.service';

/**
 * POST /api/v1/checkout/validate
 * Validate cart before checkout (check stock, calculate totals).
 * Requires authentication.
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
  }
);
