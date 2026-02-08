import prisma from '../configs/prismaConfig';
import type { UpdateProfileInput } from '../validators/profile.validator';
import type { JwtPayload } from '../types/express';

/**
 * Get or create a user profile.
 * On first access, creates a profile from the JWT payload (external auth data).
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
