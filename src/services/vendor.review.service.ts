import prisma from '../configs/prismaConfig';
import type { ReviewResponse } from '../types/review.types';
import { buildPagination } from '../utils/pagination';

interface VendorReviewsQuery {
  page?: number;
  limit?: number;
  rating?: number;
  sortBy?: 'newest' | 'oldest' | 'highest' | 'lowest';
}

/**
 * Get all reviews on a vendor's products (read-only, paginated).
 */
export async function getVendorReviews(
  vendorId: string,
  query: VendorReviewsQuery = {},
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const skip = (page - 1) * limit;

  // Get all product IDs belonging to this vendor
  const vendorProducts = await prisma.product.findMany({
    where: { vendorId },
    select: { id: true },
  });

  const productIds = vendorProducts.map((p) => p.id);

  if (productIds.length === 0) {
    return {
      data: [],
      pagination: buildPagination(0, page, limit),
    };
  }

  const where: Record<string, unknown> = {
    productId: { in: productIds },
  };

  if (query.rating) {
    where.rating = query.rating;
  }

  // Build orderBy
  let orderBy: Record<string, string>;
  switch (query.sortBy) {
    case 'oldest':  orderBy = { createdAt: 'asc' }; break;
    case 'highest': orderBy = { rating: 'desc' }; break;
    case 'lowest':  orderBy = { rating: 'asc' }; break;
    default:        orderBy = { createdAt: 'desc' };
  }

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        product: { select: { id: true, name: true, slug: true, images: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return {
    data: reviews.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: (r as any).product?.name ?? null,
      productSlug: (r as any).product?.slug ?? null,
      userId: r.userId,
      userName: r.userName,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      isVerified: r.isVerified,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    pagination: buildPagination(total, page, limit),
  };
}
