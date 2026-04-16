import prisma from '../configs/prismaConfig';
import { listProducts } from './product.service';
import type { ProductQueryInput } from '../validators/product.validator';
import type { PaginatedResult } from '../types/product.types';
import type { Product } from '../../generated/prisma';

export interface StoreInfo {
  storeName: string;
  storeSlug: string;
  storeDescription: string | null;
  productCount: number;
}

export interface StorePageResult {
  store: StoreInfo;
  products: PaginatedResult<Product>;
}

/**
 * getStoreBySlug — Returns vendor store info + paginated products.
 * Reuses listProducts with vendorId filter for consistent pagination/sorting.
 * Returns null if vendor doesn't exist, is not a vendor, or is suspended/banned.
 */
export async function getStoreBySlug(
  slug: string,
  query: Omit<ProductQueryInput, 'vendorId'>,
): Promise<StorePageResult | null> {
  // Look up vendor by slug — must be active
  const vendor = await prisma.userProfile.findFirst({
    where: { storeSlug: slug },
    select: {
      userId: true,
      storeName: true,
      storeSlug: true,
      storeDescription: true,
      isVendor: true,
      vendorStatus: true,
    },
  });

  if (!vendor || !vendor.isVendor || vendor.vendorStatus !== 'ACTIVE') {
    return null;
  }

  // Count total active+approved products for this vendor
  const productCount = await prisma.product.count({
    where: {
      vendorId: vendor.userId,
      isActive: true,
      approvalStatus: 'APPROVED',
    },
  });

  // Reuse the existing product listing query with vendorId filter
  const products = await listProducts({
    ...query,
    vendorId: vendor.userId,
  });

  return {
    store: {
      storeName: vendor.storeName!,
      storeSlug: vendor.storeSlug!,
      storeDescription: vendor.storeDescription,
      productCount,
    },
    products,
  };
}
