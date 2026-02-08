import prisma from '../configs/prismaConfig';
import type { CategorySlugQueryInput } from '../validators/category.validator';
import { paginatedResult } from '../utils/pagination';

/**
 * getAllCategories — Flat list of active categories with children embedded.
 */
export async function getAllCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    include: {
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * getCategoryTree — Only top-level categories (parentId == null) with nested children.
 * This is the hierarchical view the frontend uses for navs / sidebars.
 */
export async function getCategoryTree() {
  return prisma.category.findMany({
    where: { isActive: true, parentId: null },
    include: {
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * getCategoryBySlug — Single category + paginated products for that category.
 */
export async function getCategoryBySlug(slug: string, query: CategorySlugQueryInput) {
  const { page, limit, minPrice, maxPrice, brand, inStock, sortBy } = query;

  const category = await prisma.category.findUnique({
    where: { slug },
    include: {
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!category) return null;

  // Build product filter for this category (and its children)
  const categoryIds = [category.id, ...category.children.map((c) => c.id)];

  const where: Record<string, unknown> = {
    isActive: true,
    categoryId: { in: categoryIds },
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

  return {
    category,
    products: paginatedResult(products, total, page, limit),
  };
}

/**
 * getCategoryById — Single category by ID.
 */
export async function getCategoryById(id: string) {
  return prisma.category.findUnique({
    where: { id },
    include: {
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
}

/**
 * getFeaturedCategories — Categories flagged for homepage display.
 * We return categories that have at least one product.
 */
export async function getFeaturedCategories(limit: number = 6) {
  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      parentId: null,
    },
    include: {
      _count: { select: { products: true } },
      children: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
    take: limit,
  });

  // Add productCount to each category
  return categories.map((cat) => ({
    ...cat,
    productCount: cat._count.products,
    _count: undefined,
  }));
}
