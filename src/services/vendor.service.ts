import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { Prisma } from '../../generated/prisma';
import type { RegisterVendorInput, UpdateVendorInput, WithdrawalAccountInput } from '../validators/vendor.validator';

const DEFAULT_RESERVED_SLUGS = ['admin', 'vendor', 'account', 'auth', 'store', 'api', 'checkout', 'cart'];

function getReservedSlugs(): string[] {
  const env = process.env.RESERVED_STORE_SLUGS;
  if (env) return env.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_RESERVED_SLUGS;
}

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
  if (getReservedSlugs().includes(slug)) {
    throw createError(400, `The store name "${input.storeName}" is reserved. Please choose a different name.`);
  }

  // Pre-flight uniqueness check (defense-in-depth before DB constraint)
  const slugTaken = await prisma.userProfile.findFirst({
    where: { storeSlug: slug },
    select: { id: true },
  });
  if (slugTaken) {
    throw createError(409, `A store with a similar name already exists. Please choose a different name.`);
  }

  try {
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
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw createError(409, `A store with a similar name already exists. Please choose a different name.`);
    }
    throw err;
  }
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

    if (getReservedSlugs().includes(newSlug)) {
      throw createError(400, `The store name "${input.storeName}" is reserved. Please choose a different name.`);
    }

    // Only update slug if it actually changed
    if (newSlug !== current.storeSlug) {
      updateData.storeName = newName;
      updateData.storeSlug = newSlug;
    } else {
      updateData.storeName = newName;
    }
  }

  if (input.storeDescription !== undefined) {
    updateData.storeDescription = input.storeDescription?.trim() || null;
  }

  if (Object.keys(updateData).length === 0) {
    // Nothing to update, return current profile
    return getVendorProfile(userId);
  }

  try {
    const profile = await prisma.userProfile.update({
      where: { userId },
      data: updateData,
    });

    return profile;
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw createError(409, `A store with a similar name already exists. Please choose a different name.`);
    }
    throw err;
  }
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function accountNameMatchesProfile(
  accountName: string,
  profile: { firstName: string; lastName: string },
): boolean {
  const submitted = normalizeName(accountName);
  const firstLast = normalizeName(`${profile.firstName} ${profile.lastName}`);
  const lastFirst = normalizeName(`${profile.lastName} ${profile.firstName}`);
  return submitted === firstLast || submitted === lastFirst;
}

export async function getWithdrawalAccount(userId: string) {
  await getVendorProfile(userId);
  return prisma.vendorWithdrawalAccount.findUnique({
    where: { vendorId: userId },
  });
}

export async function upsertWithdrawalAccount(userId: string, input: WithdrawalAccountInput) {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      isVendor: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!profile?.isVendor) {
    throw createError(403, 'Vendor access required');
  }

  if (!accountNameMatchesProfile(input.accountName, profile)) {
    throw createError(400, 'Withdrawal account name must match your profile name');
  }

  return prisma.vendorWithdrawalAccount.upsert({
    where: { vendorId: userId },
    update: {
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      accountName: input.accountName.trim(),
      isVerified: true,
      verifiedAt: new Date(),
    },
    create: {
      vendorId: userId,
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      accountName: input.accountName.trim(),
      isVerified: true,
      verifiedAt: new Date(),
    },
  });
}
