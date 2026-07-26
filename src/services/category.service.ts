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
