import prisma from '../configs/prismaConfig';

/**
 * Create a test UserProfile in the database.
 * Returns the created profile.
 */
export async function createTestUser(overrides: {
  userId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
} = {}) {
  const id = overrides.userId || `test-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.userProfile.create({
    data: {
      userId: id,
      email: overrides.email || `${id}@test.com`,
      firstName: overrides.firstName || 'Test',
      lastName: overrides.lastName || 'User',
    },
  });
}
