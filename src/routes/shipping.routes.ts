import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import {
  listActiveShippingMethods,
  shippingMethodSummary,
} from '../services/shipping.service';

const router = Router();

/**
 * GET /api/v1/shipping/methods
 * Public: active delivery methods with partner names, prices and delivery
 * windows — drives the checkout selector and product-page estimates.
 */
router.get(
  '/methods',
  catchAsync(async (_req: Request, res: Response, _next: NextFunction) => {
    const methods = await listActiveShippingMethods();
    res.status(200).json({
      success: true,
      data: methods.map(shippingMethodSummary),
    });
  }),
);

export default router;
