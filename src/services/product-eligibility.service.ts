import prisma from '../configs/prismaConfig';
import createError from 'http-errors';

type ProductEligibilityInput = {
  name: string;
  isActive: boolean;
  approvalStatus?: string | null;
  vendorId?: string | null;
};

export async function getPublicProductWhere(extra: Record<string, unknown> = {}) {
  const blockedVendors = await prisma.userProfile.findMany({
    where: {
      isVendor: true,
      vendorStatus: { not: 'ACTIVE' },
    },
    select: { userId: true },
  });

  const blockedVendorIds = blockedVendors.map((vendor) => vendor.userId);
  const where: Record<string, unknown> = {
    ...extra,
    isActive: true,
    approvalStatus: 'APPROVED',
  };

  if (blockedVendorIds.length > 0) {
    const requestedVendorId = typeof extra.vendorId === 'string' ? extra.vendorId : null;
    if (requestedVendorId) {
      if (blockedVendorIds.includes(requestedVendorId)) {
        where.id = { in: [] };
      }
    } else {
      where.vendorId = {
        notIn: blockedVendorIds,
      };
    }
  }

  return where;
}

export async function assertProductPurchasable(product: ProductEligibilityInput): Promise<void> {
  if (!product.isActive) {
    throw createError(400, `${product.name} is no longer available`);
  }

  if (product.approvalStatus !== 'APPROVED') {
    throw createError(400, `${product.name} is not available for purchase`);
  }

  if (!product.vendorId) return;

  const vendor = await prisma.userProfile.findUnique({
    where: { userId: product.vendorId },
    select: { isVendor: true, vendorStatus: true },
  });

  if (!vendor || !vendor.isVendor || vendor.vendorStatus !== 'ACTIVE') {
    throw createError(400, `${product.name} is not available for purchase`);
  }
}
