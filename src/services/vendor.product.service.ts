import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import { paginatedResult } from '../utils/pagination';
import createError from 'http-errors';
import type { PaginatedResult } from '../types/product.types';
import type { Product } from '../../generated/prisma';
import type {
  VendorCreateProductInput,
  VendorUpdateProductInput,
  VendorProductQueryInput,
} from '../validators/vendor.product.validator';

const productInclude = {
  category: true,
  variants: true,
  digitalAssets: {
    select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true },
  },
};

/**
 * vendorListProducts — Paginated listing scoped to a single vendor.
 */
export async function vendorListProducts(
  vendorId: string,
  query: VendorProductQueryInput,
): Promise<PaginatedResult<Product>> {
  const { page, limit, search, categoryId, status, sortBy } = query;

  const where: Record<string, unknown> = { vendorId };

  if (status === 'active') where.isActive = true;
  else if (status === 'inactive') where.isActive = false;

  if (categoryId) where.categoryId = categoryId;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { tags: { hasSome: [search.toLowerCase()] } },
    ];
  }

  type OrderBy = Record<string, 'asc' | 'desc'>;
  let orderBy: OrderBy = { createdAt: 'desc' };

  switch (sortBy) {
    case 'name_asc':  orderBy = { name: 'asc' }; break;
    case 'name_desc': orderBy = { name: 'desc' }; break;
    case 'price_asc': orderBy = { basePrice: 'asc' }; break;
    case 'price_desc': orderBy = { basePrice: 'desc' }; break;
    case 'oldest':    orderBy = { createdAt: 'asc' }; break;
    case 'newest':
    default:          orderBy = { createdAt: 'desc' };
  }

  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return paginatedResult(products, total, page, limit);
}

/**
 * vendorGetProduct — Single product lookup, scoped to vendor.
 */
export async function vendorGetProduct(vendorId: string, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: productInclude,
  });

  if (!product) {
    throw createError(404, 'Product not found');
  }

  if (product.vendorId !== vendorId) {
    throw createError(403, 'You do not have access to this product');
  }

  return product;
}

/**
 * vendorCreateProduct — Creates a new digital product owned by the vendor.
 */
export async function vendorCreateProduct(vendorId: string, input: VendorCreateProductInput) {
  const { variants, ...productData } = input;

  // Generate unique slug
  let slug = slugify(productData.name);
  const existing = await prisma.product.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  // Auto-generate unique SKU for vendor products
  const sku = `VND-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const product = await prisma.product.create({
    data: {
      ...productData,
      slug,
      stockKeepingUnit: sku,
      vendorId,
      type: 'DIGITAL',
      approvalStatus: 'APPROVED',
      stock: 999999, // Digital products have unlimited stock
      images: JSON.parse(JSON.stringify(productData.images || [])),
      variants: variants && variants.length > 0
        ? {
            create: variants.map((v) => ({
              ...v,
              stockKeepingUnit: v.stockKeepingUnit || `VND-V-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              attributes: JSON.parse(JSON.stringify(v.attributes)),
            })),
          }
        : undefined,
    },
    include: productInclude,
  });

  return product;
}

/**
 * vendorUpdateProduct — Updates a product only if it belongs to the vendor.
 */
export async function vendorUpdateProduct(
  vendorId: string,
  productId: string,
  input: VendorUpdateProductInput,
) {
  // Verify ownership
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { vendorId: true },
  });

  if (!existing) {
    throw createError(404, 'Product not found');
  }

  if (existing.vendorId !== vendorId) {
    throw createError(403, 'You do not have access to this product');
  }

  const { variants, ...productData } = input;

  // If name changed, regenerate slug
  const data: Record<string, unknown> = { ...productData };
  if (productData.name) {
    let slug = slugify(productData.name);
    const slugExists = await prisma.product.findFirst({
      where: { slug, id: { not: productId } },
    });
    if (slugExists) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    data.slug = slug;
  }

  // Handle images JSON field
  if (productData.images !== undefined) {
    data.images = JSON.parse(JSON.stringify(productData.images));
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data,
    include: productInclude,
  });

  // Update variants if provided
  if (variants !== undefined) {
    await prisma.productVariant.deleteMany({ where: { productId } });

    if (variants.length > 0) {
      await prisma.productVariant.createMany({
        data: variants.map((v) => ({
          productId,
          ...v,
          stockKeepingUnit: v.stockKeepingUnit || `VND-V-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          attributes: JSON.parse(JSON.stringify(v.attributes)),
        })),
      });
    }

    return prisma.product.findUnique({
      where: { id: productId },
      include: productInclude,
    });
  }

  return product;
}

/**
 * vendorDeleteProduct — Soft-deletes a product only if it belongs to the vendor.
 */
export async function vendorDeleteProduct(vendorId: string, productId: string) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { vendorId: true },
  });

  if (!existing) {
    throw createError(404, 'Product not found');
  }

  if (existing.vendorId !== vendorId) {
    throw createError(403, 'You do not have access to this product');
  }

  return prisma.product.update({
    where: { id: productId },
    data: { isActive: false },
  });
}

/**
 * vendorToggleProduct — Toggles isActive for a vendor's product.
 */
export async function vendorToggleProduct(vendorId: string, productId: string, isActive: boolean) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { vendorId: true },
  });

  if (!existing) {
    throw createError(404, 'Product not found');
  }

  if (existing.vendorId !== vendorId) {
    throw createError(403, 'You do not have access to this product');
  }

  return prisma.product.update({
    where: { id: productId },
    data: { isActive },
    include: productInclude,
  });
}
