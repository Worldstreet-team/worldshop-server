import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { ADDRESS_LIMITS } from '../types/address.types';
import type { CreateAddressInput, UpdateAddressInput } from '../validators/address.validator';

/**
 * Get all addresses for a user (ordered: default first, then newest).
 */
export async function getUserAddresses(userId: string) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Get a single address by ID, ensuring ownership.
 */
export async function getAddressById(addressId: string, userId: string) {
  const address = await prisma.address.findUnique({
    where: { id: addressId },
  });

  if (!address) {
    throw createError(404, 'Address not found');
  }

  if (address.userId !== userId) {
    throw createError(403, 'Not authorized to access this address');
  }

  return address;
}

/**
 * Create a new address for a user.
 * Enforces max 5 per user. If isDefault, unsets other defaults.
 */
export async function createAddress(userId: string, input: CreateAddressInput) {
  // Check limit
  const count = await prisma.address.count({ where: { userId } });
  if (count >= ADDRESS_LIMITS.MAX_PER_USER) {
    throw createError(400, `You can save a maximum of ${ADDRESS_LIMITS.MAX_PER_USER} addresses. Please delete one before adding a new one.`);
  }

  // If this is the first address or isDefault requested, handle default logic
  const shouldBeDefault = input.isDefault || count === 0;

  if (shouldBeDefault) {
    // Unset any existing default
    await prisma.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.address.create({
    data: {
      userId,
      label: input.label,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      street: input.street,
      apartment: input.apartment,
      city: input.city,
      state: input.state,
      country: input.country || 'Nigeria',
      postalCode: input.postalCode,
      isDefault: shouldBeDefault,
    },
  });
}

/**
 * Update an existing address (ownership verified).
 * If setting as default, unsets other defaults.
 */
export async function updateAddress(
  addressId: string,
  userId: string,
  input: UpdateAddressInput
) {
  // Verify ownership
  const existing = await getAddressById(addressId, userId);

  // If setting as default, unset others
  if (input.isDefault && !existing.isDefault) {
    await prisma.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.address.update({
    where: { id: addressId },
    data: input,
  });
}

/**
 * Delete an address.
 * Prevents deleting the default address.
 */
export async function deleteAddress(addressId: string, userId: string) {
  const address = await getAddressById(addressId, userId);

  if (address.isDefault) {
    throw createError(400, 'Cannot delete the default address. Set another address as default first.');
  }

  await prisma.address.delete({
    where: { id: addressId },
  });

  return { message: 'Address deleted successfully' };
}

/**
 * Set an address as the user's default.
 * Unsets the previous default.
 */
export async function setDefaultAddress(addressId: string, userId: string) {
  // Verify ownership
  await getAddressById(addressId, userId);

  // Unset current default
  await prisma.address.updateMany({
    where: { userId, isDefault: true },
    data: { isDefault: false },
  });

  // Set new default
  return prisma.address.update({
    where: { id: addressId },
    data: { isDefault: true },
  });
}
