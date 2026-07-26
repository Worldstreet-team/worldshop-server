import { Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import prisma from '../configs/prismaConfig';
import * as reviewService from '../services/marketplace.review.service';
import { reviewQuerySchema, reviewStatusSchema } from '../validators/marketplace.review.validator';

function userId(req: Request): string {
  if (!req.user?.id) throw createError(401, 'Authentication required');
  return req.user.id;
}

/** GET /api/v1/listings/:id/reviews */
export const listForListing = catchAsync(async (req: Request, res: Response) => {
  const query = reviewQuerySchema.parse(req.query);
  const { reviews, total, summary } = await reviewService.listProductReviews(
    String(req.params.id),
    query,
  );

  res.status(200).json({
    success: true,
    data: reviews,
    meta: summary,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/**
 * GET /api/v1/listings/:id/reviews/eligibility
 * Lets the UI explain the rule up front instead of rejecting a written review.
 */
export const eligibility = catchAsync(async (req: Request, res: Response) => {
  const result = await reviewService.checkEligibility(userId(req), String(req.params.id));
  res.status(200).json({ success: true, data: result });
});

/** GET /api/v1/listings/:id/reviews/mine */
export const mine = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.getMyReviewForProduct(userId(req), String(req.params.id));
  res.status(200).json({ success: true, data: review });
});

/** POST /api/v1/listings/:id/reviews */
export const create = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.createReview(userId(req), String(req.params.id), req.body);

  res.status(201).json({
    success: true,
    data: review,
    message: review.isVerified
      ? 'Review posted.'
      : 'Review posted. It will show as verified once the seller has replied to your message.',
  });
});

/** PATCH /api/v1/reviews/:id */
export const update = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.updateReview(userId(req), String(req.params.id), req.body);
  res.status(200).json({ success: true, data: review, message: 'Review updated' });
});

/** DELETE /api/v1/reviews/:id */
export const remove = catchAsync(async (req: Request, res: Response) => {
  await reviewService.deleteReview(userId(req), String(req.params.id));
  res.status(200).json({ success: true, message: 'Review deleted' });
});

/** POST /api/v1/reviews/:id/reply — the vendor's public response */
export const reply = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.replyToReview(userId(req), String(req.params.id), req.body.reply);
  res.status(200).json({ success: true, data: review, message: 'Reply posted' });
});

/** DELETE /api/v1/reviews/:id/reply */
export const removeReply = catchAsync(async (req: Request, res: Response) => {
  const review = await reviewService.deleteVendorReply(userId(req), String(req.params.id));
  res.status(200).json({ success: true, data: review, message: 'Reply removed' });
});

/** GET /api/v1/stores/:slug/reviews — a store's reputation page */
export const listForStore = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const store = await prisma.store.findUnique({
    where: { slug: String(req.params.slug) },
    select: { id: true, status: true },
  });
  // Mirrors the store page itself: an unpaid or suspended store is not visible.
  if (!store || !['ACTIVE', 'GRACE'].includes(store.status)) {
    return next(createError(404, 'Store not found'));
  }

  const query = reviewQuerySchema.parse(req.query);
  const { reviews, total, summary } = await reviewService.listStoreReviews(store.id, query);

  res.status(200).json({
    success: true,
    data: reviews,
    meta: summary,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/**
 * GET /api/v1/stores/me/reviews — the owner's view of their own reviews.
 *
 * Separate from the public store route because that one enforces visibility: a
 * vendor whose subscription lapsed still needs to read and answer reviews, and
 * arguably needs to more than anyone.
 */
export const listMine = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const storeId = req.store?.id;
  if (!storeId) return next(createError(403, 'Create a store first'));

  const query = reviewQuerySchema.parse(req.query);
  const unrepliedOnly = req.query.unrepliedOnly === 'true';

  const { reviews, total, summary } = await reviewService.listStoreReviews(storeId, {
    ...query,
    unrepliedOnly,
  });

  res.status(200).json({
    success: true,
    data: reviews,
    meta: summary,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/** PATCH /api/v1/admin/reviews/:id/status */
export const setStatus = catchAsync(async (req: Request, res: Response) => {
  const { status } = reviewStatusSchema.parse(req.body);
  const review = await reviewService.setReviewStatus(String(req.params.id), status);

  res.status(200).json({
    success: true,
    data: review,
    message: `Review marked ${status.toLowerCase()}.`,
  });
});
