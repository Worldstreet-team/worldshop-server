import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import { paginatedResult } from '../utils/pagination';
import type { PaginatedResult } from '../types/product.types';
import type { Product } from '../../generated/prisma';
import type {
  CreateProductInput,
  UpdateProductInput,
  AdminProductQueryInput,
} from '../validators/admin.product.validator';

/**
 * adminListProducts — Paginated product listing for admin (includes inactive).
 */
export async function adminListProducts(query: AdminProductQueryInput): Promise<PaginatedResult<Product>> {
  const { page, limit, search, categoryId, status, stock, sortBy } = query;

  const where: Record<string, unknown> = {};

  // Status filter
  if (status === 'active') where.isActive = true;
  else if (status === 'inactive') where.isActive = false;
  // 'all' → no filter

  // Category
  if (categoryId) where.categoryId = categoryId;

  // Stock filter
  if (stock === 'in-stock') where.stock = { gt: 10 };
  else if (stock === 'low-stock') where.stock = { gt: 0, lte: 10 };
  else if (stock === 'out-of-stock') where.stock = { lte: 0 };

  // Search
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { stockKeepingUnit: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Sorting
  type OrderBy = Record<string, 'asc' | 'desc'>;
  let orderBy: OrderBy = { createdAt: 'desc' };

  switch (sortBy) {
    case 'name_asc':    orderBy = { name: 'asc' }; break;
    case 'name_desc':   orderBy = { name: 'desc' }; break;
    case 'price_asc':   orderBy = { basePrice: 'asc' }; break;
    case 'price_desc':  orderBy = { basePrice: 'desc' }; break;
    case 'stock_asc':   orderBy = { stock: 'asc' }; break;
    case 'stock_desc':  orderBy = { stock: 'desc' }; break;
    case 'oldest':      orderBy = { createdAt: 'asc' }; break;
    case 'newest':
    default:            orderBy = { createdAt: 'desc' };
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

  return paginatedResult(products, total, page, limit);
}

/**
 * createProduct — Creates a new product with optional variants.
 */
export async function createProduct(input: CreateProductInput) {
  const { variants, ...productData } = input;

  // Generate unique slug
  let slug = slugify(productData.name);
  const existing = await prisma.product.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const product = await prisma.product.create({
    data: {
      ...productData,
      slug,
      images: JSON.parse(JSON.stringify(productData.images)),
      variants: variants && variants.length > 0
        ? { create: variants.map((v) => ({ ...v, attributes: JSON.parse(JSON.stringify(v.attributes)) })) }
        : undefined,
    },
    include: { category: true, variants: true },
  });

  return product;
}

/**
 * updateProduct — Updates an existing product.
 */
export async function updateProduct(id: string, input: UpdateProductInput) {
  const { variants, ...productData } = input;

  // If name changed, regenerate slug
  if (productData.name) {
    let slug = slugify(productData.name);
    const existing = await prisma.product.findFirst({
      where: { slug, id: { not: id } },
    });
    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    (productData as Record<string, unknown>).slug = slug;
  }

  // Handle images JSON field
  const data: Record<string, unknown> = { ...productData };
  if (productData.images !== undefined) {
    data.images = JSON.parse(JSON.stringify(productData.images));
  }

  const product = await prisma.product.update({
    where: { id },
    data,
    include: { category: true, variants: true },
  });

  // Update variants if provided
  if (variants !== undefined) {
    // Delete existing variants and recreate
    await prisma.productVariant.deleteMany({ where: { productId: id } });

    if (variants.length > 0) {
      await prisma.productVariant.createMany({
        data: variants.map((v) => ({
          productId: id,
          ...v,
          attributes: JSON.parse(JSON.stringify(v.attributes)),
        })),
      });
    }

    // Re-fetch with updated variants
    return prisma.product.findUnique({
      where: { id },
      include: { category: true, variants: true },
    });
  }

  return product;
}

/**
 * deleteProduct — Soft-deletes a product (sets isActive = false).
 */
export async function deleteProduct(id: string) {
  return prisma.product.update({
    where: { id },
    data: { isActive: false },
    include: { category: true },
  });
}

/**
 * hardDeleteProduct — Permanently deletes a product and its variants.
 */
export async function hardDeleteProduct(id: string) {
  // Delete variants first
  await prisma.productVariant.deleteMany({ where: { productId: id } });
  return prisma.product.delete({ where: { id } });
}

/**
 * getDashboardStats — Returns overview statistics for the admin dashboard.
 */
export async function getDashboardStats() {
  const [
    totalProducts,
    activeProducts,
    outOfStockProducts,
    lowStockProducts,
    totalOrders,
    totalRevenue,
    recentOrders,
    totalCategories,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({ where: { stock: { lte: 0 } } }),
    prisma.product.count({ where: { stock: { gt: 0, lte: 10 } } }),
    prisma.order.count(),
    prisma.order.aggregate({ _sum: { total: true }, where: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } } }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { items: true },
    }),
    prisma.category.count({ where: { isActive: true } }),
  ]);

  return {
    totalProducts,
    activeProducts,
    outOfStockProducts,
    lowStockProducts,
    totalOrders,
    totalRevenue: totalRevenue._sum.total || 0,
    totalCategories,
    recentOrders,
  };
}
