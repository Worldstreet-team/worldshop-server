import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { ReviewResponse, ReviewSummary, PaginatedReviews } from '../types/review.types';
import type { CreateReviewInput, UpdateReviewInput, ReviewsQueryInput } from '../validators/review.validator';
import { buildPagination } from '../utils/pagination';

/**
 * Check if user has a DELIVERED order containing a specific product.
 */
async function hasUserPurchasedProduct(userId: string, productId: string): Promise<boolean> {
  const order = await prisma.order.findFirst({
    where: {
      userId,
      status: 'DELIVERED',
      items: { some: { productId } },
    },
    select: { id: true },
  });
  return !!order;
}

/**
 * Recalculate and update avgRating / reviewCount on Product.
 */
async function recalculateProductRating(productId: string): Promise<void> {
  const aggregation = await prisma.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      avgRating: Math.round((aggregation._avg.rating || 0) * 10) / 10,
      reviewCount: aggregation._count.rating,
    },
  });
}

/**
 * Get rating distribution for a product (count per star).
 */
async function getRatingDistribution(productId: string): Promise<ReviewSummary['distribution']> {
  const distribution: ReviewSummary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  const groups = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId },
    _count: { rating: true },
  });

  for (const g of groups) {
    const star = g.rating as 1 | 2 | 3 | 4 | 5;
    distribution[star] = g._count.rating;
  }

  return distribution;
}

/**
 * Get paginated reviews for a product.
 */
export async function getProductReviews(
  productId: string,
  query: ReviewsQueryInput,
): Promise<PaginatedReviews> {
  // Verify product exists
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, avgRating: true, reviewCount: true } });
  if (!product) throw createError(404, 'Product not found');

  const { page, limit, rating, sortBy } = query;
  const skip = (page - 1) * limit;

  // Build where clause
  const where: Record<string, unknown> = { productId };
  if (rating) where.rating = rating;

  // Build orderBy
  let orderBy: Record<string, string>;
  switch (sortBy) {
    case 'oldest': orderBy = { createdAt: 'asc' }; break;
    case 'highest': orderBy = { rating: 'desc' }; break;
    case 'lowest': orderBy = { rating: 'asc' }; break;
    default: orderBy = { createdAt: 'desc' };
  }

  const [reviews, total, distribution] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
    getRatingDistribution(productId),
  ]);

  return {
    data: reviews as ReviewResponse[],
    summary: {
      averageRating: product.avgRating,
      totalCount: product.reviewCount,
      distribution,
    },
    pagination: buildPagination(total, page, limit),
  };
}

/**
 * Get review summary (rating + distribution) for a product.
 */
export async function getReviewSummary(productId: string): Promise<ReviewSummary> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { avgRating: true, reviewCount: true } });
  if (!product) throw createError(404, 'Product not found');

  const distribution = await getRatingDistribution(productId);

  return {
    averageRating: product.avgRating,
    totalCount: product.reviewCount,
    distribution,
  };
}

/**
 * Create a review for a product.
 */
export async function createReview(
  productId: string,
  userId: string,
  userName: string,
  data: CreateReviewInput,
): Promise<ReviewResponse> {
  // Verify product exists
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw createError(404, 'Product not found');

  // Check if user already reviewed this product
  const existingReview = await prisma.review.findUnique({
    where: { productId_userId: { productId, userId } },
  });
  if (existingReview) throw createError(409, 'You have already reviewed this product');

  // Check if purchase is verified
  const isVerified = await hasUserPurchasedProduct(userId, productId);

  const review = await prisma.review.create({
    data: {
      productId,
      userId,
      userName,
      rating: data.rating,
      title: data.title || null,
      comment: data.comment,
      isVerified,
    },
  });

  // Recalculate product rating
  await recalculateProductRating(productId);

  return review as ReviewResponse;
}

/**
 * Update own review.
 */
export async function updateReview(
  reviewId: string,
  userId: string,
  data: UpdateReviewInput,
): Promise<ReviewResponse> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw createError(404, 'Review not found');
  if (review.userId !== userId) throw createError(403, 'You can only edit your own reviews');

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      ...(data.rating !== undefined && { rating: data.rating }),
      ...(data.title !== undefined && { title: data.title }),
      ...(data.comment !== undefined && { comment: data.comment }),
    },
  });

  // Recalculate product rating if rating changed
  if (data.rating !== undefined) {
    await recalculateProductRating(review.productId);
  }

  return updated as ReviewResponse;
}

/**
 * Delete own review.
 */
export async function deleteReview(reviewId: string, userId: string): Promise<void> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw createError(404, 'Review not found');
  if (review.userId !== userId) throw createError(403, 'You can only delete your own reviews');

  await prisma.review.delete({ where: { id: reviewId } });

  // Recalculate product rating
  await recalculateProductRating(review.productId);
}

/**
 * Get a user's review for a specific product (if exists).
 */
export async function getUserReviewForProduct(
  productId: string,
  userId: string,
): Promise<ReviewResponse | null> {
  const review = await prisma.review.findUnique({
    where: { productId_userId: { productId, userId } },
  });
  return review as ReviewResponse | null;
}
