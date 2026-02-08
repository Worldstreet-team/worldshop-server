import prisma from '../configs/prismaConfig';
import type { UpdateProfileInput } from '../validators/profile.validator';
import type { JwtPayload } from '../types/express';

/**
 * Get or create a user profile.
 * On first access, creates a profile from the JWT payload (external auth data).
 * Also updates empty names from JWT if available.
 */
export async function getOrCreateProfile(user: JwtPayload) {
  if (!user.id) {
    throw new Error('User ID is required to get or create a profile');
  }

  let profile = await prisma.userProfile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    profile = await prisma.userProfile.create({
      data: {
        userId: user.id,
        email: user.email || '',
        firstName: user.firstName || 'User',
        lastName: user.lastName || '',
      },
    });
  } else {
    // Update profile with JWT data if names are empty but JWT has them
    const needsUpdate =
      (!profile.firstName && user.firstName) ||
      (!profile.lastName && user.lastName);

    if (needsUpdate) {
      profile = await prisma.userProfile.update({
        where: { userId: user.id },
        data: {
          firstName: profile.firstName || user.firstName || 'User',
          lastName: profile.lastName || user.lastName || '',
        },
      });
    }
  }

  return profile;
}

/**
 * Update the user's profile.
 */
export async function updateProfile(userId: string, data: UpdateProfileInput) {
  // Build the update payload, converting dateOfBirth string to Date
  const updateData: Record<string, unknown> = { ...data };
  if (data.dateOfBirth !== undefined) {
    updateData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  }

  const profile = await prisma.userProfile.update({
    where: { userId },
    data: updateData,
  });

  return profile;
}

/**
 * Get profile by userId (internal use).
 */
export async function getProfileByUserId(userId: string) {
  return prisma.userProfile.findUnique({
    where: { userId },
  });
}
