/**
 * Reviews for the marketplace model.
 *
 * The old anchor is gone: `isVerified` used to mean "this user has a DELIVERED
 * order for this product", and there are no orders any more. Without some
 * anchor this is an open fake-review surface, and it is the single most common
 * way classifieds platforms lose buyer trust.
 *
 * The anchor is the chat thread, in two tiers:
 *
 *   - to review at all, you must have messaged the store about that listing
 *   - `isVerified` is set only if the vendor actually replied
 *
 * Requiring a *reply* to review at all would be worse than it looks: it hands
 * vendors a suppression switch. Ignore anyone who sounds unhappy and they can
 * never review you. Gating on the buyer's own action instead cannot be gamed
 * from the vendor's side, and the badge still distinguishes a real two-way
 * exchange from a drive-by.
 *
 * Vendors get a public right of reply, which matters more here than in an
 * ecommerce shop: they have no refund or resolution lever, so a response is
 * their only defence against an unfair review.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import type { Prisma } from '../../generated/prisma';

/** Reviews the public is allowed to see. Removed ones vanish; flagged stay up. */
const PUBLIC_STATUSES: Prisma.EnumReviewStatusFilter = { in: ['PUBLISHED', 'FLAGGED'] };

export type ReviewEligibility = {
  canReview: boolean;
  wouldBeVerified: boolean;
  reason?: string;
  conversationId?: string;
};

/**
 * Whether this user may review this listing, and whether it would carry the
 * verified badge. Exposed so the UI can explain the rule before someone writes
 * a review rather than rejecting it afterwards.
 */
export async function checkEligibility(userId: string, productId: string): Promise<ReviewEligibility> {
  const listing = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, storeId: true, store: { select: { ownerId: true } } },
  });
  if (!listing) throw createError(404, 'Listing not found');

  if (listing.store?.ownerId === userId) {
    return { canReview: false, wouldBeVerified: false, reason: 'You cannot review your own store' };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { listingId: productId, buyerId: userId },
    select: { id: true, vendorFirstReplyAt: true },
  });

  if (!conversation) {
    return {
      canReview: false,
      wouldBeVerified: false,
      reason: 'Message the seller about this item before reviewing it',
    };
  }

  return {
    canReview: true,
    wouldBeVerified: conversation.vendorFirstReplyAt !== null,
    conversationId: conversation.id,
  };
}

/**
 * Recomputes both rollups a review affects: the listing's own rating, and the
 * store's across all of its listings.
 *
 * Store rating is what buyers judge a seller by, and it is computed over every
 * review of every listing — a vendor should not be able to bury a bad review by
 * deleting the listing it was left on, which is why `Review.storeId` is stored
 * independently of the listing.
 */
async function recomputeRatings(productId: string, storeId?: string | null) {
  const product = await prisma.review.aggregate({
    where: { productId, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      avgRating: Math.round((product._avg.rating || 0) * 10) / 10,
      reviewCount: product._count.rating,
    },
  });

  if (!storeId) return;

  const store = await prisma.review.aggregate({
    where: { storeId, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.store.update({
    where: { id: storeId },
    data: {
      avgRating: Math.round((store._avg.rating || 0) * 10) / 10,
      reviewCount: store._count.rating,
    },
  });
}

export async function createReview(
  userId: string,
  productId: string,
  input: { rating: number; title?: string; comment: string },
) {
  const eligibility = await checkEligibility(userId, productId);
  if (!eligibility.canReview) throw createError(403, eligibility.reason!);

  const existing = await prisma.review.findFirst({ where: { productId, userId } });
  if (existing) throw createError(409, 'You have already reviewed this item — edit your review instead');

  const [listing, profile] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { storeId: true } }),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { firstName: true, lastName: true },
    }),
  ]);
  if (!profile) throw createError(404, 'Complete your profile before reviewing');

  const review = await prisma.review.create({
    data: {
      productId,
      storeId: listing?.storeId,
      userId,
      userName: `${profile.firstName} ${profile.lastName}`.trim(),
      rating: input.rating,
      title: input.title,
      comment: input.comment,
      conversationId: eligibility.conversationId,
      isVerified: eligibility.wouldBeVerified,
    },
  });

  await recomputeRatings(productId, listing?.storeId);
  return review;
}

export async function updateReview(
  userId: string,
  reviewId: string,
  input: { rating?: number; title?: string | null; comment?: string },
) {
  const review = await prisma.review.findFirst({ where: { id: reviewId, userId } });
  if (!review) throw createError(404, 'Review not found');
  if (review.status === 'REMOVED') throw createError(403, 'This review was removed by an administrator');

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: {
      rating: input.rating,
      title: input.title,
      comment: input.comment,
      // An edited review invalidates the vendor's reply to the old text —
      // leaving it attached would misrepresent what they were answering.
      ...(input.comment && input.comment !== review.comment && review.vendorReply
        ? { vendorReply: null, vendorRepliedAt: null }
        : {}),
    },
  });

  if (input.rating != null) await recomputeRatings(review.productId, review.storeId);
  return updated;
}

export async function deleteReview(userId: string, reviewId: string) {
  const review = await prisma.review.findFirst({ where: { id: reviewId, userId } });
  if (!review) throw createError(404, 'Review not found');

  await prisma.review.delete({ where: { id: reviewId } });
  await recomputeRatings(review.productId, review.storeId);
}

/**
 * The vendor's public response. One reply per review, editable: a vendor who
 * cools down and rewrites an angry first response should be able to, and the
 * timestamp shows when they last did.
 */
export async function replyToReview(ownerId: string, reviewId: string, reply: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: { store: { select: { ownerId: true } } },
  });
  if (!review) throw createError(404, 'Review not found');
  if (review.store?.ownerId !== ownerId) throw createError(403, 'This review is not on your store');
  if (review.status === 'REMOVED') throw createError(403, 'This review was removed by an administrator');

  return prisma.review.update({
    where: { id: reviewId },
    data: { vendorReply: reply, vendorRepliedAt: new Date() },
  });
}

export async function deleteVendorReply(ownerId: string, reviewId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: { store: { select: { ownerId: true } } },
  });
  if (!review) throw createError(404, 'Review not found');
  if (review.store?.ownerId !== ownerId) throw createError(403, 'This review is not on your store');

  return prisma.review.update({
    where: { id: reviewId },
    data: { vendorReply: null, vendorRepliedAt: null },
  });
}

const REVIEW_SELECT = {
  id: true,
  rating: true,
  title: true,
  comment: true,
  userName: true,
  userId: true,
  isVerified: true,
  vendorReply: true,
  vendorRepliedAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function distribution(where: Prisma.ReviewWhereInput) {
  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const groups = await prisma.review.groupBy({ by: ['rating'], where, _count: { rating: true } });
  for (const g of groups) dist[g.rating as 1 | 2 | 3 | 4 | 5] = g._count.rating;
  return dist;
}

export async function listProductReviews(
  productId: string,
  opts: { page: number; limit: number; verifiedOnly?: boolean },
) {
  const where: Prisma.ReviewWhereInput = {
    productId,
    status: PUBLIC_STATUSES,
    ...(opts.verifiedOnly ? { isVerified: true } : {}),
  };

  const [reviews, total, dist] = await Promise.all([
    prisma.review.findMany({
      where,
      select: REVIEW_SELECT,
      // Verified reviews first: they are the ones backed by a real exchange.
      orderBy: [{ isVerified: 'desc' }, { createdAt: 'desc' }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.review.count({ where }),
    distribution({ productId, status: PUBLIC_STATUSES }),
  ]);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { avgRating: true, reviewCount: true },
  });

  return {
    reviews,
    total,
    summary: {
      averageRating: product?.avgRating ?? 0,
      reviewCount: product?.reviewCount ?? 0,
      distribution: dist,
      verifiedCount: await prisma.review.count({ where: { productId, isVerified: true, status: PUBLIC_STATUSES } }),
    },
  };
}

/** Every review across a store's listings — the store's reputation page. */
export async function listStoreReviews(
  storeId: string,
  opts: { page: number; limit: number; verifiedOnly?: boolean; unrepliedOnly?: boolean },
) {
  const where: Prisma.ReviewWhereInput = {
    storeId,
    status: PUBLIC_STATUSES,
    ...(opts.verifiedOnly ? { isVerified: true } : {}),
    // A never-written field is not null in MongoDB, so matching only null would
    // report no unanswered reviews at all.
    ...(opts.unrepliedOnly
      ? { OR: [{ vendorReply: null }, { vendorReply: { isSet: false } }] }
      : {}),
  };

  const [reviews, total, dist] = await Promise.all([
    prisma.review.findMany({
      where,
      select: { ...REVIEW_SELECT, product: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ isVerified: 'desc' }, { createdAt: 'desc' }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.review.count({ where }),
    distribution({ storeId, status: PUBLIC_STATUSES }),
  ]);

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { avgRating: true, reviewCount: true, responseRate: true, avgResponseMins: true },
  });

  return {
    reviews,
    total,
    summary: {
      averageRating: store?.avgRating ?? 0,
      reviewCount: store?.reviewCount ?? 0,
      distribution: dist,
      // Shown alongside the rating: how attentive the seller is, which matters
      // as much as their score when nothing is transacted on-platform.
      responseRate: store?.responseRate ?? null,
      avgResponseMins: store?.avgResponseMins ?? null,
    },
  };
}

/** Admin moderation. Removing a review pulls it out of both rollups. */
export async function setReviewStatus(
  reviewId: string,
  status: 'PUBLISHED' | 'FLAGGED' | 'REMOVED',
) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw createError(404, 'Review not found');

  const updated = await prisma.review.update({ where: { id: reviewId }, data: { status } });
  await recomputeRatings(review.productId, review.storeId);
  return updated;
}

export async function getMyReviewForProduct(userId: string, productId: string) {
  return prisma.review.findFirst({ where: { productId, userId }, select: REVIEW_SELECT });
}
