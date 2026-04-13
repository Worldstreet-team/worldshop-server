import prisma from '../configs/prismaConfig';
import { slugify } from '../utils/slugify';
import { paginatedResult } from '../utils/pagination';
import createError from 'http-errors';
import type { PaginatedResult } from '../types/product.types';
import type { Product, Category, ProductVariant, DigitalAsset } from '../../generated/prisma';
import type {
  AdminCreateProductInput,
  AdminUpdateProductInput,
  VendorCreateProductInput,
  VendorUpdateProductInput,
  ProductListQueryInput,
} from '../validators/product.management.validator';

// ─── Context ────────────────────────────────────────────────────

export interface ProductContext {
  role: 'admin' | 'vendor';
  userId: string;
  vendorId?: string; // Required when role='vendor'
}

// ─── Product with relations (returned by all methods) ───────────

export type ProductWithRelations = Product & {
  category: Category | null;
  variants: ProductVariant[];
  digitalAssets: DigitalAsset[] | Pick<DigitalAsset, 'id' | 'fileName' | 'mimeType' | 'fileSize' | 'sortOrder'>[];
};

// ─── Role Rules (data-driven, not scattered branches) ───────────

interface RoleRules {
  searchFields: ('name' | 'stockKeepingUnit' | 'brand' | 'tags')[];
  stockFilter: boolean;
  sortOptions: string[];
  includeClause: Record<string, unknown>;
}

const ROLE_RULES: Record<'admin' | 'vendor', RoleRules> = {
  admin: {
    searchFields: ['name', 'stockKeepingUnit', 'brand'],
    stockFilter: true,
    sortOptions: ['name_asc', 'name_desc', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc', 'newest', 'oldest'],
    includeClause: { category: true, variants: true, digitalAssets: true },
  },
  vendor: {
    searchFields: ['name', 'tags'],
    stockFilter: false,
    sortOptions: ['name_asc', 'name_desc', 'price_asc', 'price_desc', 'newest', 'oldest'],
    includeClause: {
      category: true,
      variants: true,
      digitalAssets: {
        select: { id: true, fileName: true, mimeType: true, fileSize: true, sortOrder: true },
      },
    },
  },
};

// ─── ProductService ─────────────────────────────────────────────

export class ProductService {
  private rules: RoleRules;

  constructor(private context: ProductContext) {
    if (context.role === 'vendor' && !context.vendorId) {
      throw new Error('Vendor context requires vendorId');
    }
    this.rules = ROLE_RULES[context.role];
  }

  // ── List ────────────────────────────────────────────────────────

  async list(query: ProductListQueryInput): Promise<PaginatedResult<ProductWithRelations>> {
    const { page, limit, search, categoryId, status, stock, sortBy } = query;
    const where: Record<string, unknown> = {};

    // Vendor scoping
    if (this.context.role === 'vendor') {
      where.vendorId = this.context.vendorId;
    }

    // Status filter
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;

    // Category
    if (categoryId) where.categoryId = categoryId;

    // Stock filter (admin only)
    if (this.rules.stockFilter && stock && stock !== 'all') {
      if (stock === 'in-stock') where.stock = { gt: 10 };
      else if (stock === 'low-stock') where.stock = { gt: 0, lte: 10 };
      else if (stock === 'out-of-stock') where.stock = { lte: 0 };
    }

    // Search (role-specific fields)
    if (search) {
      where.OR = this.buildSearchClauses(search);
    }

    // Sorting (validated against role's allowed options)
    const orderBy = this.buildOrderBy(sortBy);
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: this.rules.includeClause,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return paginatedResult(products as unknown as ProductWithRelations[], total, page, limit);
  }

  // ── Get ─────────────────────────────────────────────────────────

  async get(productId: string): Promise<ProductWithRelations> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: this.rules.includeClause,
    });

    if (!product) {
      throw createError(404, 'Product not found');
    }

    if (this.context.role === 'vendor' && product.vendorId !== this.context.vendorId) {
      throw createError(403, 'You do not have access to this product');
    }

    return product as unknown as ProductWithRelations;
  }

  // ── Create ──────────────────────────────────────────────────────

  async create(input: AdminCreateProductInput | VendorCreateProductInput): Promise<ProductWithRelations> {
    if (this.context.role === 'vendor') {
      return this.createVendorProduct(input as VendorCreateProductInput);
    }
    return this.createAdminProduct(input as AdminCreateProductInput);
  }

  // ── Update ──────────────────────────────────────────────────────

  async update(productId: string, input: AdminUpdateProductInput | VendorUpdateProductInput): Promise<ProductWithRelations> {
    // Ownership check for vendors
    if (this.context.role === 'vendor') {
      await this.ensureOwnership(productId);
    }

    const { variants, ...productData } = input as AdminUpdateProductInput;

    // Regenerate slug if name changed
    const data: Record<string, unknown> = { ...productData };
    if (productData.name) {
      data.slug = await this.generateUniqueSlug(productData.name, productId);
    }

    // Handle images JSON field
    if (productData.images !== undefined) {
      data.images = JSON.parse(JSON.stringify(productData.images));
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data,
      include: this.rules.includeClause,
    });

    // Replace variants if provided
    if (variants !== undefined) {
      await prisma.productVariant.deleteMany({ where: { productId } });

      if (variants.length > 0) {
        await prisma.productVariant.createMany({
          data: variants.map((v) => ({
            productId,
            ...v,
            stockKeepingUnit: this.context.role === 'vendor'
              ? (v.stockKeepingUnit || this.generateVendorSku())
              : v.stockKeepingUnit,
            attributes: JSON.parse(JSON.stringify(v.attributes)),
          })),
        });
      }

      return (await prisma.product.findUnique({
        where: { id: productId },
        include: this.rules.includeClause,
      }))! as unknown as ProductWithRelations;
    }

    return product as unknown as ProductWithRelations;
  }

  // ── Delete (soft) ───────────────────────────────────────────────

  async delete(productId: string): Promise<void> {
    if (this.context.role === 'vendor') {
      await this.ensureOwnership(productId);
    } else {
      // Admin: verify product exists
      const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!exists) throw createError(404, 'Product not found');
    }

    await prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
  }

  // ── Toggle ──────────────────────────────────────────────────────

  async toggle(productId: string, isActive: boolean): Promise<ProductWithRelations> {
    if (this.context.role === 'vendor') {
      await this.ensureOwnership(productId);
    }

    return prisma.product.update({
      where: { id: productId },
      data: { isActive },
      include: this.rules.includeClause,
    }) as unknown as Promise<ProductWithRelations>;
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private buildSearchClauses(search: string): Record<string, unknown>[] {
    const clauses: Record<string, unknown>[] = [];

    for (const field of this.rules.searchFields) {
      if (field === 'tags') {
        clauses.push({ tags: { hasSome: [search.toLowerCase()] } });
      } else {
        clauses.push({ [field]: { contains: search, mode: 'insensitive' } });
      }
    }

    return clauses;
  }

  private buildOrderBy(sortBy?: string): Record<string, 'asc' | 'desc'> {
    // Fall back to newest and ignore invalid sorts for the role
    if (!sortBy || !this.rules.sortOptions.includes(sortBy)) {
      return { createdAt: 'desc' };
    }

    switch (sortBy) {
      case 'name_asc':    return { name: 'asc' };
      case 'name_desc':   return { name: 'desc' };
      case 'price_asc':   return { basePrice: 'asc' };
      case 'price_desc':  return { basePrice: 'desc' };
      case 'stock_asc':   return { stock: 'asc' };
      case 'stock_desc':  return { stock: 'desc' };
      case 'oldest':      return { createdAt: 'asc' };
      case 'newest':
      default:            return { createdAt: 'desc' };
    }
  }

  private async generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
    let slug = slugify(name);
    const existing = excludeId
      ? await prisma.product.findFirst({ where: { slug, id: { not: excludeId } } })
      : await prisma.product.findUnique({ where: { slug } });

    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }
    return slug;
  }

  private generateVendorSku(): string {
    return `VND-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async ensureOwnership(productId: string): Promise<void> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { vendorId: true },
    });

    if (!product) {
      throw createError(404, 'Product not found');
    }

    if (product.vendorId !== this.context.vendorId) {
      throw createError(403, 'You do not have access to this product');
    }
  }

  private async createAdminProduct(input: AdminCreateProductInput): Promise<ProductWithRelations> {
    const { variants, ...productData } = input;
    const slug = await this.generateUniqueSlug(productData.name);

    return prisma.product.create({
      data: {
        ...productData,
        slug,
        images: JSON.parse(JSON.stringify(productData.images)),
        stock: productData.type === 'DIGITAL' ? 999999 : productData.stock,
        variants: variants && variants.length > 0
          ? { create: variants.map((v) => ({ ...v, attributes: JSON.parse(JSON.stringify(v.attributes)) })) }
          : undefined,
      },
      include: this.rules.includeClause,
    }) as unknown as Promise<ProductWithRelations>;
  }

  private async createVendorProduct(input: VendorCreateProductInput): Promise<ProductWithRelations> {
    const { variants, ...productData } = input;
    const slug = await this.generateUniqueSlug(productData.name);
    const sku = this.generateVendorSku();

    return prisma.product.create({
      data: {
        ...productData,
        slug,
        stockKeepingUnit: sku,
        vendorId: this.context.vendorId!,
        type: 'DIGITAL',
        approvalStatus: 'APPROVED',
        stock: 999999,
        images: JSON.parse(JSON.stringify(productData.images || [])),
        variants: variants && variants.length > 0
          ? {
              create: variants.map((v) => ({
                ...v,
                stockKeepingUnit: v.stockKeepingUnit || this.generateVendorSku(),
                attributes: JSON.parse(JSON.stringify(v.attributes)),
              })),
            }
          : undefined,
      },
      include: this.rules.includeClause,
    }) as unknown as Promise<ProductWithRelations>;
  }
}

// ─── Dashboard Stats (admin-only, kept separate) ────────────────

export async function getDashboardStats(page = 1, limit = 15) {
  const skip = (page - 1) * limit;

  const [
    totalProducts,
    activeProducts,
    outOfStockProducts,
    lowStockProducts,
    totalOrders,
    totalRevenue,
    recentOrders,
    recentOrdersTotal,
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
      skip,
      take: limit,
      include: {
        items: {
          select: {
            productName: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    }),
    prisma.order.count(),
    prisma.category.count({ where: { isActive: true } }),
  ]);

  const mappedOrders = recentOrders.map((order) => {
    const shipping = order.shippingAddress as Record<string, unknown> | null;
    const customerName = shipping
      ? `${shipping.firstName || ''} ${shipping.lastName || ''}`.trim()
      : null;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      customerName,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    };
  });

  return {
    totalProducts,
    activeProducts,
    outOfStockProducts,
    lowStockProducts,
    totalOrders,
    totalRevenue: totalRevenue._sum.total || 0,
    totalCategories,
    recentOrders: mappedOrders,
    recentOrdersPagination: {
      page,
      limit,
      total: recentOrdersTotal,
      totalPages: Math.ceil(recentOrdersTotal / limit),
      hasPrevPage: page > 1,
      hasNextPage: page * limit < recentOrdersTotal,
    },
  };
}

/**
 * hardDeleteProduct — Permanently deletes a product and its variants (admin only).
 */
export async function hardDeleteProduct(id: string) {
  await prisma.productVariant.deleteMany({ where: { productId: id } });
  return prisma.product.delete({ where: { id } });
}
