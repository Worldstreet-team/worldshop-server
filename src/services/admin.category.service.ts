import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import type { CreateCategoryInput, UpdateCategoryInput } from '../validators/admin.category.validator';

/**
 * adminListCategories — All categories (including inactive) with product count.
 */
export async function adminListCategories(includeInactive: boolean = true) {
  const where = includeInactive ? {} : { isActive: true };

  const categories = await prisma.category.findMany({
    where,
    include: {
      _count: { select: { products: true } },
      parent: { select: { id: true, name: true, slug: true } },
      children: { select: { id: true, name: true, slug: true, isActive: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  return categories.map((cat) => ({
    ...cat,
    productCount: cat._count.products,
    _count: undefined,
  }));
}

/**
 * createCategory — Creates a new category.
 */
export async function createCategory(input: CreateCategoryInput) {
  // Generate unique slug  
  let slug = slugify(input.name);
  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  return prisma.category.create({
    data: {
      ...input,
      slug,
    },
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      children: { select: { id: true, name: true, slug: true, isActive: true } },
      _count: { select: { products: true } },
    },
  });
}

/**
 * updateCategory — Updates an existing category.
 */
export async function updateCategory(id: string, input: UpdateCategoryInput) {
  const data: Record<string, unknown> = { ...input };

  // If name changed, regenerate slug
  if (input.name) {
    let slug = slugify(input.name);
    const existing = await prisma.category.findFirst({
      where: { slug, id: { not: id } },
    });
    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    data.slug = slug;
  }

  return prisma.category.update({
    where: { id },
    data,
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      children: { select: { id: true, name: true, slug: true, isActive: true } },
      _count: { select: { products: true } },
    },
  });
}

/**
 * deleteCategory — Soft-deletes a category.
 * Optionally moves products to a different category first.
 */
export async function deleteCategory(id: string, moveProductsTo?: string) {
  // Move products if target category provided
  if (moveProductsTo) {
    await prisma.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: moveProductsTo },
    });
  }

  // Unlink child categories
  await prisma.category.updateMany({
    where: { parentId: id },
    data: { parentId: null },
  });

  return prisma.category.update({
    where: { id },
    data: { isActive: false },
  });
}

/**
 * getCategoryById — Admin single category lookup (includes inactive).
 */
export async function getCategoryById(id: string) {
  return prisma.category.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      children: { select: { id: true, name: true, slug: true, isActive: true } },
      _count: { select: { products: true } },
    },
  });
}
