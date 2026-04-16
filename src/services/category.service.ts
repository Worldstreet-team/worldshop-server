import prisma from '../configs/prismaConfig';
import type { CategorySlugQueryInput } from '../validators/category.validator';
import { paginatedResult } from '../utils/pagination';
import {
  signCategoryRecord,
  signCategoryRecords,
  signProductRecords,
} from '../utils/signUrl';

/**
 * getAllCategories — Flat list of active categories with their product count.
 */
export async function getAllCategories() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const mapped = categories.map((cat) => ({
    ...cat,
    productCount: cat._count.products,
    _count: undefined,
  }));

  return signCategoryRecords(mapped);
}

/**
 * getCategoryBySlug — Single category + paginated products.
 */
export async function getCategoryBySlug(
  slug: string,
  query: CategorySlugQueryInput,
) {
  const { page, limit, minPrice, maxPrice, brand, inStock, sortBy } = query;

  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) return null;

  const where: Record<string, unknown> = {
    categoryId: category.id,
  };

  if (minPrice !== undefined || maxPrice !== undefined) {
    const priceFilter: Record<string, number> = {};
    if (minPrice !== undefined) priceFilter.gte = minPrice;
    if (maxPrice !== undefined) priceFilter.lte = maxPrice;
    where.basePrice = priceFilter;
  }

  if (brand) where.brand = brand;
  if (inStock) where.stock = { gt: 0 };

  // Sorting
  type OrderBy = Record<string, 'asc' | 'desc'>;
  let orderBy: OrderBy = { createdAt: 'desc' };

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
    default:
      orderBy = { createdAt: 'desc' };
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true, variants: true },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  const signedCategory = await signCategoryRecord(category);
  const signedProducts = await signProductRecords(products);

  return {
    category: signedCategory,
    products: paginatedResult(signedProducts, total, page, limit),
  };
}

/**
 * getCategoryById — Single category by ID.
 */
export async function getCategoryById(id: string) {
  const cat = await prisma.category.findUnique({ where: { id } });
  return cat ? signCategoryRecord(cat) : null;
}

/**
 * getFeaturedCategories — Active categories with product count (for homepage).
 */
export async function getFeaturedCategories(limit: number = 4) {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: {
          products: true,
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
    take: limit,
  });

  const mapped = categories.map((cat) => ({
    ...cat,
    productCount: cat._count.products,
    _count: undefined,
  }));

  return signCategoryRecords(mapped);
}
