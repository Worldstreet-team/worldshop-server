import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { RegisterVendorInput, UpdateVendorInput } from '../validators/vendor.validator';

const RESERVED_SLUGS = ['admin', 'vendor', 'account', 'auth', 'store', 'api', 'checkout', 'cart'];

/**
 * Convert a store name to a URL-safe slug.
 * Lowercase, replace spaces/special chars with hyphens, collapse multiples.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Register a user as a vendor.
 * Creates vendor fields on their existing UserProfile.
 */
export async function registerVendor(userId: string, input: RegisterVendorInput) {
  // Check if already a vendor
  const existing = await prisma.userProfile.findUnique({
    where: { userId },
    select: { isVendor: true },
  });

  if (!existing) {
    throw createError(404, 'User profile not found');
  }

  if (existing.isVendor) {
    throw createError(409, 'You are already registered as a vendor');
  }

  const slug = generateSlug(input.storeName);

  if (!slug) {
    throw createError(400, 'Store name must contain at least one alphanumeric character');
  }

  // Check reserved slugs
  if (RESERVED_SLUGS.includes(slug)) {
    throw createError(400, `The store name "${input.storeName}" is reserved. Please choose a different name.`);
  }

  // Check slug uniqueness
  const slugTaken = await prisma.userProfile.findUnique({
    where: { storeSlug: slug },
    select: { id: true },
  });

  if (slugTaken) {
    throw createError(409, `A store with a similar name already exists. Please choose a different name.`);
  }

  const profile = await prisma.userProfile.update({
    where: { userId },
    data: {
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: input.storeName.trim(),
      storeSlug: slug,
      storeDescription: input.storeDescription?.trim() || null,
      vendorSince: new Date(),
    },
  });

  return profile;
}

/**
 * Get vendor profile for an authenticated vendor.
 */
export async function getVendorProfile(userId: string) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      userId: true,
      email: true,
      firstName: true,
      lastName: true,
      isVendor: true,
      vendorStatus: true,
      storeName: true,
      storeSlug: true,
      storeDescription: true,
      vendorSince: true,
    },
  });

  if (!profile || !profile.isVendor) {
    throw createError(403, 'Vendor access required');
  }

  return profile;
}

/**
 * Update vendor store name and/or description.
 * Regenerates slug if store name changes.
 */
export async function updateVendorProfile(userId: string, input: UpdateVendorInput) {
  const current = await prisma.userProfile.findUnique({
    where: { userId },
    select: { isVendor: true, storeName: true, storeSlug: true },
  });

  if (!current || !current.isVendor) {
    throw createError(403, 'Vendor access required');
  }

  const updateData: Record<string, unknown> = {};

  if (input.storeName !== undefined) {
    const newName = input.storeName.trim();
    const newSlug = generateSlug(newName);

    if (!newSlug) {
      throw createError(400, 'Store name must contain at least one alphanumeric character');
    }

    if (RESERVED_SLUGS.includes(newSlug)) {
      throw createError(400, `The store name "${input.storeName}" is reserved. Please choose a different name.`);
    }

    // Only check uniqueness if slug actually changed
    if (newSlug !== current.storeSlug) {
      const slugTaken = await prisma.userProfile.findUnique({
        where: { storeSlug: newSlug },
        select: { id: true },
      });

      if (slugTaken) {
        throw createError(409, `A store with a similar name already exists. Please choose a different name.`);
      }
    }

    updateData.storeName = newName;
    updateData.storeSlug = newSlug;
  }

  if (input.storeDescription !== undefined) {
    updateData.storeDescription = input.storeDescription?.trim() || null;
  }

  if (Object.keys(updateData).length === 0) {
    // Nothing to update, return current profile
    return getVendorProfile(userId);
  }

  const profile = await prisma.userProfile.update({
    where: { userId },
    data: updateData,
  });

  return profile;
}
