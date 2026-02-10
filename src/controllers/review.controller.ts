import { Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import * as reviewService from '../services/review.service';
import { createReviewSchema, updateReviewSchema, reviewsQuerySchema } from '../validators/review.validator';

/**
 * GET /api/v1/products/:productId/reviews
 * Get paginated reviews for a product (public).
 */
export const getProductReviews = catchAsync(async (req: Request, res: Response) => {
  const productId = req.params.productId as string;
  const query = reviewsQuerySchema.parse(req.query);

  const result = await reviewService.getProductReviews(productId, query);

  res.status(200).json({ success: true, ...result });
});

/**
 * GET /api/v1/products/:productId/reviews/summary
 * Get review summary for a product (public).
 */
export const getReviewSummary = catchAsync(async (req: Request, res: Response) => {
  const productId = req.params.productId as string;

  const summary = await reviewService.getReviewSummary(productId);

  res.status(200).json({ success: true, summary });
});

/**
 * GET /api/v1/products/:productId/reviews/mine
 * Get current user's review for a product (auth required).
 */
export const getMyReview = catchAsync(async (req: Request, res: Response) => {
  const productId = req.params.productId as string;
  const userId = req.user!.id;

  const review = await reviewService.getUserReviewForProduct(productId, userId);

  res.status(200).json({ success: true, review });
});

/**
 * POST /api/v1/products/:productId/reviews
 * Create a review for a product (auth required).
 */
export const createReview = catchAsync(async (req: Request, res: Response) => {
  const productId = req.params.productId as string;
  const userId = req.user!.id;
  const userName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
  const data = createReviewSchema.parse(req.body);

  const review = await reviewService.createReview(productId, userId, userName, data);

  res.status(201).json({ success: true, review });
});

/**
 * PUT /api/v1/products/:productId/reviews/:reviewId
 * Update own review (auth required).
 */
export const updateReview = catchAsync(async (req: Request, res: Response) => {
  const reviewId = req.params.reviewId as string;
  const userId = req.user!.id;
  const data = updateReviewSchema.parse(req.body);

  const review = await reviewService.updateReview(reviewId, userId, data);

  res.status(200).json({ success: true, review });
});

/**
 * DELETE /api/v1/products/:productId/reviews/:reviewId
 * Delete own review (auth required).
 */
export const deleteReview = catchAsync(async (req: Request, res: Response) => {
  const reviewId = req.params.reviewId as string;
  const userId = req.user!.id;

  await reviewService.deleteReview(reviewId, userId);

  res.status(200).json({ success: true, message: 'Review deleted successfully' });
});
