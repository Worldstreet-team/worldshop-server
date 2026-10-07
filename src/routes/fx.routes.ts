import { Router, Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import { getUsdRates } from '../services/fx.service';

const router = Router();

/**
 * GET /api/v1/fx/usd — USD to every currency, for display. Public: rates are
 * public data, and the pricing pages that use it are seen before sign-in.
 */
router.get(
  '/usd',
  catchAsync(async (_req: Request, res: Response, _next: NextFunction) => {
    const data = await getUsdRates();
    // Browsers and proxies may reuse it for a while too; it moves daily.
    res.set('Cache-Control', 'public, max-age=900');
    res.status(200).json({ success: true, data });
  }),
);

export default router;
