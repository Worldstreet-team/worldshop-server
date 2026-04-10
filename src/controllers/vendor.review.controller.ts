import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as vendorReviewService from '../services/vendor.review.service';
import { reviewsQuerySchema } from '../validators/review.validator';

/**
 * GET /api/v1/vendor/reviews
 * Returns all reviews on the vendor's products (read-only, paginated).
 */
export const getReviews = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const query = reviewsQuerySchema.parse(req.query);

  const result = await vendorReviewService.getVendorReviews(vendorId, query);

  res.status(200).json({
    success: true,
    ...result,
  });
});
