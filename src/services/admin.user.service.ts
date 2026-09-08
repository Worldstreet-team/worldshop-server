import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { buildPagination } from '../utils/pagination';
import { globalLog } from '../configs/loggerConfig';
import { issueSetupToken, revokeAdminAccess } from './auth.service';
import type { AdminUserListInput, AdminUserRoleInput } from '../validators/admin.user.validator';

function seededAdminEmails(): string[] {
  return (process.env.SEEDED_ADMIN_EMAILS || process.env.SEED_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function assertCanManageAdmins(adminUserId: string) {
  const admin = await prisma.userProfile.findUnique({
    where: { userId: adminUserId },
    select: { role: true, email: true },
  });

  if (!admin || admin.role !== 'ADMIN') {
    throw createError(403, 'Admin access required');
  }

  const allowedEmails = seededAdminEmails();
  if (allowedEmails.length > 0 && !allowedEmails.includes(admin.email.toLowerCase())) {
    throw createError(403, 'Only the seeded admin can promote users');
  }
}

export async function listUsers(query: AdminUserListInput) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (query.role) where.role = query.role;
  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: 'insensitive' } },
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.userProfile.findMany({
      where,
      select: {
        id: true,
        userId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.userProfile.count({ where }),
  ]);

  return {
    data: users,
    pagination: buildPagination(total, page, limit),
  };
}

export async function updateUserRole(
  adminUserId: string,
  profileId: string,
  input: AdminUserRoleInput,
) {
  await assertCanManageAdmins(adminUserId);

  const target = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      userId: true,
      role: true,
      email: true,
      firstName: true,
      passwordHash: true,
    },
  });

  if (!target) throw createError(404, 'User not found');
  if (target.userId === adminUserId && input.role !== 'ADMIN') {
    throw createError(400, 'You cannot remove your own admin role');
  }

  const updated = await prisma.userProfile.update({
    where: { id: profileId },
    data: { role: input.role },
    select: {
      id: true,
      userId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
    },
  });

  const promoted = target.role !== 'ADMIN' && input.role === 'ADMIN';
  const demoted = target.role === 'ADMIN' && input.role !== 'ADMIN';

  // A new admin has no password yet, so mail them a link to choose one. Someone
  // being re-promoted keeps the password they already set — no email needed.
  if (promoted && !target.passwordHash) {
    try {
      await issueSetupToken(target.userId, target.email, target.firstName);
      return { ...updated, setupEmailSent: true };
    } catch (err) {
      // The promotion itself stands; the console reports the failed invite so
      // an admin can retry, and the new admin can request a link themselves.
      globalLog.error('Failed to send admin setup email', {
        userId: target.userId,
        message: (err as Error)?.message,
      });
      return { ...updated, setupEmailSent: false };
    }
  }

  if (demoted) await revokeAdminAccess(target.userId);

  return updated;
}
