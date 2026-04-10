import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { buildPagination } from '../utils/pagination';

// ─── Types ──────────────────────────────────────────────────────

interface AdminVendorListQuery {
  page?: number;
  limit?: number;
  status?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  search?: string;
  sortBy?: 'newest' | 'oldest' | 'name_asc' | 'name_desc';
}

// ─── List all vendors ───────────────────────────────────────────

export async function listVendors(query: AdminVendorListQuery = {}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { isVendor: true };

  if (query.status) {
    where.vendorStatus = query.status;
  }

  if (query.search) {
    where.OR = [
      { storeName: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  // Sorting
  let orderBy: Record<string, string> = { vendorSince: 'desc' };
  switch (query.sortBy) {
    case 'oldest':    orderBy = { vendorSince: 'asc' }; break;
    case 'name_asc':  orderBy = { storeName: 'asc' }; break;
    case 'name_desc': orderBy = { storeName: 'desc' }; break;
    default:          orderBy = { vendorSince: 'desc' };
  }

  const [vendors, total] = await Promise.all([
    prisma.userProfile.findMany({
      where,
      select: {
        id: true,
        userId: true,
        email: true,
        firstName: true,
        lastName: true,
        vendorStatus: true,
        storeName: true,
        storeSlug: true,
        storeDescription: true,
        vendorSince: true,
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.userProfile.count({ where }),
  ]);

  // Enrich with product count and total earnings per vendor
  const enriched = await Promise.all(
    vendors.map(async (v) => {
      const [productCount, balance] = await Promise.all([
        prisma.product.count({ where: { vendorId: v.userId } }),
        prisma.vendorBalance.findUnique({ where: { vendorId: v.userId } }),
      ]);

      return {
        ...v,
        productCount,
        totalEarnings: balance?.totalEarned ?? 0,
      };
    }),
  );

  return {
    data: enriched,
    pagination: buildPagination(total, page, limit),
  };
}

// ─── Get single vendor detail ───────────────────────────────────

export async function getVendorDetail(vendorProfileId: string) {
  const vendor = await prisma.userProfile.findUnique({
    where: { id: vendorProfileId },
    select: {
      id: true,
      userId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      vendorStatus: true,
      storeName: true,
      storeSlug: true,
      storeDescription: true,
      vendorSince: true,
      createdAt: true,
    },
  });

  if (!vendor || !vendor.storeName) {
    throw createError(404, 'Vendor not found');
  }

  // Aggregate stats
  const [productCount, orderCount, balance, recentOrders] = await Promise.all([
    prisma.product.count({ where: { vendorId: vendor.userId } }),
    prisma.order.count({ where: { vendorId: vendor.userId } }),
    prisma.vendorBalance.findUnique({ where: { vendorId: vendor.userId } }),
    prisma.order.findMany({
      where: { vendorId: vendor.userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    ...vendor,
    stats: {
      productCount,
      orderCount,
      totalEarnings: balance?.totalEarned ?? 0,
      totalCommission: balance?.totalCommission ?? 0,
      availableBalance: balance?.availableBalance ?? 0,
    },
    recentOrders,
  };
}

// ─── Update vendor status ───────────────────────────────────────

export async function updateVendorStatus(
  vendorProfileId: string,
  newStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED',
) {
  const vendor = await prisma.userProfile.findUnique({
    where: { id: vendorProfileId },
    select: { id: true, isVendor: true, vendorStatus: true, storeName: true },
  });

  if (!vendor || !vendor.isVendor) {
    throw createError(404, 'Vendor not found');
  }

  if (vendor.vendorStatus === newStatus) {
    throw createError(400, `Vendor is already ${newStatus}`);
  }

  const updated = await prisma.userProfile.update({
    where: { id: vendorProfileId },
    data: { vendorStatus: newStatus },
    select: {
      id: true,
      userId: true,
      storeName: true,
      vendorStatus: true,
    },
  });

  return updated;
}

// ─── Get vendor's products (for admin review) ───────────────────

export async function getVendorProducts(
  vendorUserId: string,
  query: { page?: number; limit?: number } = {},
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const where = { vendorId: vendorUserId };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true, variants: true, digitalAssets: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    data: products,
    pagination: buildPagination(total, page, limit),
  };
}

// ─── Update commission rate ─────────────────────────────────────

export async function updateCommissionRate(newRate: number) {
  if (newRate < 0 || newRate > 1) {
    throw createError(400, 'Commission rate must be between 0 and 1');
  }

  const config = await prisma.platformConfig.upsert({
    where: { key: 'commissionRate' },
    update: { value: newRate.toString() },
    create: { key: 'commissionRate', value: newRate.toString() },
  });

  return { key: config.key, value: parseFloat(config.value as string) };
}

// ─── Get commission rate ────────────────────────────────────────

export async function getCommissionRate() {
  const config = await prisma.platformConfig.findUnique({
    where: { key: 'commissionRate' },
  });

  return {
    key: 'commissionRate',
    value: config ? parseFloat(config.value as string) : 0.10,
  };
}
