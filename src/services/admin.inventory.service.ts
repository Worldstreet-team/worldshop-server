import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type {
  InventoryQueryInput,
  AdjustStockInput,
  UpdateThresholdInput,
} from '../validators/admin.inventory.validator';
import { signProductImages } from '../utils/signUrl';

export interface InventoryItem {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  type: string;
  image: string | null;
  stock: number;
  lowStockThreshold: number;
  status: 'in-stock' | 'low-stock' | 'out-of-stock';
  categoryName: string | null;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    stock: number;
  }>;
}

export interface InventoryStats {
  totalProducts: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
}

/**
 * List products with inventory data.
 */
export async function listInventory(query: InventoryQueryInput) {
  const { page, limit, search, stock, categoryId, sortBy } = query;

  const where: Record<string, unknown> = {
    isActive: true,
    type: 'PHYSICAL', // Only show physical products in inventory
  };

  // Search
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { stockKeepingUnit: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Category
  if (categoryId) where.categoryId = categoryId;

  // Stock filter
  if (stock === 'in-stock') where.stock = { gt: 10 };
  else if (stock === 'low-stock') {
    where.AND = [
      { stock: { gt: 0 } },
      { stock: { lte: prisma.product.fields?.lowStockThreshold ?? 10 } },
    ];
    // Use raw filter — Prisma doesn't support field-to-field comparison
    // Fallback: use a simple threshold
    delete (where as Record<string, unknown>).AND;
    where.stock = { gt: 0, lte: 10 };
  } else if (stock === 'out-of-stock') where.stock = { lte: 0 };

  // Sorting
  type OrderBy = Record<string, 'asc' | 'desc'>;
  let orderBy: OrderBy;
  switch (sortBy) {
    case 'name_asc':   orderBy = { name: 'asc' }; break;
    case 'name_desc':  orderBy = { name: 'desc' }; break;
    case 'stock_desc': orderBy = { stock: 'desc' }; break;
    case 'oldest':     orderBy = { createdAt: 'asc' }; break;
    case 'newest':     orderBy = { createdAt: 'desc' }; break;
    case 'stock_asc':
    default:           orderBy = { stock: 'asc' };
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where: where as any,
      include: {
        category: { select: { name: true } },
        variants: {
          select: { id: true, name: true, stockKeepingUnit: true, stock: true },
          where: { isActive: true },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where: where as any }),
  ]);

  // Format and sign images
  const data: InventoryItem[] = await Promise.all(
    products.map(async (product) => {
      // Get primary image
      const images = await signProductImages(product.images);
      const primaryImage = images.find((img) => img.isPrimary)?.url as string ||
        images[0]?.url as string ||
        null;

      const stockStatus: 'in-stock' | 'low-stock' | 'out-of-stock' =
        product.stock <= 0
          ? 'out-of-stock'
          : product.stock <= product.lowStockThreshold
          ? 'low-stock'
          : 'in-stock';

      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        sku: product.stockKeepingUnit,
        type: product.type,
        image: primaryImage,
        stock: product.stock,
        lowStockThreshold: product.lowStockThreshold,
        status: stockStatus,
        categoryName: product.category?.name || null,
        variants: product.variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.stockKeepingUnit,
          stock: v.stock,
        })),
      };
    })
  );

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get inventory statistics.
 */
export async function getInventoryStats(): Promise<InventoryStats> {
  const [totalProducts, outOfStock, lowStock] = await Promise.all([
    prisma.product.count({ where: { isActive: true, type: 'PHYSICAL' } }),
    prisma.product.count({ where: { isActive: true, type: 'PHYSICAL', stock: { lte: 0 } } }),
    prisma.product.count({
      where: { isActive: true, type: 'PHYSICAL', stock: { gt: 0, lte: 10 } },
    }),
  ]);

  return {
    totalProducts,
    inStock: totalProducts - outOfStock - lowStock,
    lowStock,
    outOfStock,
  };
}

/**
 * Adjust stock for a product (or variant).
 */
export async function adjustStock(
  productId: string,
  input: AdjustStockInput
) {
  const { adjustment, reason, variantId } = input;

  if (variantId) {
    // Adjust variant stock
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });

    if (!variant || variant.productId !== productId) {
      throw createError(404, 'Product variant not found');
    }

    const newStock = variant.stock + adjustment;
    if (newStock < 0) {
      throw createError(400, `Cannot reduce stock below 0. Current: ${variant.stock}, adjustment: ${adjustment}`);
    }

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: newStock },
    });

    return {
      productId,
      variantId,
      previousStock: variant.stock,
      adjustment,
      newStock: updated.stock,
      reason,
    };
  }

  // Adjust product stock
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw createError(404, 'Product not found');
  }

  const newStock = product.stock + adjustment;
  if (newStock < 0) {
    throw createError(400, `Cannot reduce stock below 0. Current: ${product.stock}, adjustment: ${adjustment}`);
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { stock: newStock },
  });

  return {
    productId,
    variantId: null,
    previousStock: product.stock,
    adjustment,
    newStock: updated.stock,
    reason,
  };
}

/**
 * Update low stock threshold for a product.
 */
export async function updateThreshold(
  productId: string,
  input: UpdateThresholdInput
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw createError(404, 'Product not found');
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { lowStockThreshold: input.lowStockThreshold },
  });

  return {
    productId,
    previousThreshold: product.lowStockThreshold,
    newThreshold: updated.lowStockThreshold,
  };
}

/**
 * Get low stock alerts — products at or below their threshold.
 */
export async function getLowStockAlerts() {
  // MongoDB doesn't support field-to-field comparison in Prisma,
  // so we fetch products with stock <= 10 (a reasonable threshold)
  // and filter in memory
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      type: 'PHYSICAL',
      stock: { lte: 20 }, // Fetch candidates
    },
    include: {
      category: { select: { name: true } },
    },
    orderBy: { stock: 'asc' },
    take: 50,
  });

  // Filter: stock <= lowStockThreshold
  const alerts = products
    .filter((p) => p.stock <= p.lowStockThreshold)
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.stockKeepingUnit,
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      categoryName: p.category?.name || null,
    }));

  return alerts;
}
