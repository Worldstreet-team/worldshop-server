import prisma from '../configs/prismaConfig';
import type { ProductQueryInput, SearchQueryInput } from '../validators/product.validator';
import { paginatedResult } from '../utils/pagination';
import type { PaginatedResult } from '../types/product.types';
import type { Product } from '../../generated/prisma';

/**
 * listProducts — Paginated, filterable product listing.
 * Supports: search, category, price range, brand, rating, stock, featured, sorting.
 */
export async function listProducts(query: ProductQueryInput): Promise<PaginatedResult<Product>> {
  const { page, limit, search, categoryId, categorySlug, minPrice, maxPrice, brand, rating, inStock, isFeatured, sortBy } = query;

  // ── Build filter ──────────────────────────────────────────────
  const where: Record<string, unknown> = { isActive: true };

  // Category by ID or slug
  if (categoryId) {
    where.categoryId = categoryId;
  } else if (categorySlug) {
    const cat = await prisma.category.findUnique({ where: { slug: categorySlug }, select: { id: true } });
    if (cat) where.categoryId = cat.id;
  }

  // Price range
  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceFilter: Record<string, number> = {};
    if (minPrice !== undefined) priceFilter.gte = minPrice;
    if (maxPrice !== undefined) priceFilter.lte = maxPrice;
    where.basePrice = priceFilter;
  }

  // Brand
  if (brand) where.brand = brand;

  // Minimum average rating
  if (rating) where.avgRating = { gte: rating };

  // In-stock only
  if (inStock) where.stock = { gt: 0 };

  // Featured only
  if (isFeatured !== undefined) where.isFeatured = isFeatured;

  // Full-text search on name, description, tags
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { tags: { hasSome: [search.toLowerCase()] } },
    ];
  }

  // ── Sorting ───────────────────────────────────────────────────
  type OrderBy = Record<string, 'asc' | 'desc'>;
  let orderBy: OrderBy = { createdAt: 'desc' }; // default: newest

  switch (sortBy) {
    case 'price_asc':
      orderBy = { basePrice: 'asc' };
      break;
    case 'price_desc':
      orderBy = { basePrice: 'desc' };
      break;
    case 'name_asc':
      orderBy = { name: 'asc' };
      break;
    case 'name_desc':
      orderBy = { name: 'desc' };
      break;
    case 'rating':
      orderBy = { avgRating: 'desc' };
      break;
    case 'popular':
      orderBy = { reviewCount: 'desc' };
      break;
    case 'newest':
    default:
      orderBy = { createdAt: 'desc' };
  }

  // ── Query ─────────────────────────────────────────────────────
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true, variants: true, digitalAssets: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true } } },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return paginatedResult(products, total, page, limit);
}

/**
 * getProductBySlug — Single product lookup by slug.
 */
export async function getProductBySlug(slug: string) {
  return prisma.product.findUnique({
    where: { slug },
    include: { category: true, variants: true, digitalAssets: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true } } },
  });
}

/**
 * getProductById — Single product lookup by ID.
 */
export async function getProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: { category: true, variants: true, digitalAssets: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true } } },
  });
}

/**
 * getFeaturedProducts — Returns featured products up to a limit.
 */
export async function getFeaturedProducts(limit: number = 8) {
  return prisma.product.findMany({
    where: { isActive: true, isFeatured: true },
    include: { category: true, variants: true, digitalAssets: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * getRelatedProducts — Same category, excluding the given product.
 */
export async function getRelatedProducts(productId: string, limit: number = 8) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true },
  });

  if (!product?.categoryId) return [];

  const related = await prisma.product.findMany({
    where: {
      isActive: true,
      categoryId: product.categoryId,
      id: { not: productId },
    },
    include: { category: true, variants: true, digitalAssets: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true } } },
    orderBy: { avgRating: 'desc' },
    take: limit,
  });

  // Back-fill from other categories if needed
  if (related.length < limit) {
    const backfill = await prisma.product.findMany({
      where: {
        isActive: true,
        id: { notIn: [productId, ...related.map((r) => r.id)] },
      },
      include: { category: true, variants: true, digitalAssets: { select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true } } },
      orderBy: { avgRating: 'desc' },
      take: limit - related.length,
    });
    related.push(...backfill);
  }

  return related;
}

/**
 * searchProducts — Lightweight search returning up to `limit` results.
 */
export async function searchProducts(q: string, limit: number = 10) {
  return prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { tags: { hasSome: [q.toLowerCase()] } },
      ],
    },
    include: { category: true },
    orderBy: { avgRating: 'desc' },
    take: limit,
  });
}

/**
 * getProductPriceRange — Min and max prices across active products.
 */
export async function getProductPriceRange() {
  const [result] = await prisma.product.aggregateRaw({
    pipeline: [
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          min: { $min: '$basePrice' },
          max: { $max: '$basePrice' },
        },
      },
    ],
  }) as unknown as { min: number; max: number }[];

  return result ? { min: result.min, max: result.max } : { min: 0, max: 0 };
}

/**
 * getAllBrands — Distinct brand values across active products.
 */
export async function getAllBrands() {
  const products = await prisma.product.findMany({
    where: { isActive: true, brand: { not: null } },
    select: { brand: true },
    distinct: ['brand'],
    orderBy: { brand: 'asc' },
  });

  return products.map((p) => p.brand).filter(Boolean) as string[];
}
