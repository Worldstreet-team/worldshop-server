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

/**
 * Where an admin stands with their password. A promoted admin cannot sign in
 * until they follow their emailed link, so the console needs to tell a working
 * account apart from a stalled invite.
 */
export type AdminInviteStatus = 'ACTIVE' | 'AWAITING_SETUP' | 'INVITE_EXPIRED';

/** The shape every user-shaped admin response returns. */
const USER_SELECT = {
  id: true,
  userId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  createdAt: true,
  passwordHash: true,
} as const;

type UserRow = {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: Date;
  passwordHash: string | null;
};

/**
 * Builds the response one field at a time rather than spreading the row.
 * `passwordHash` is selected only to derive the status, and a spread would put
 * a bcrypt hash straight into an API response.
 */
function toAdminUserDto(user: UserRow, inviteExpiresAt: Date | null) {
  const adminStatus: AdminInviteStatus | null =
    user.role !== 'ADMIN'
      ? null
      : user.passwordHash
        ? 'ACTIVE'
        : inviteExpiresAt
          ? 'AWAITING_SETUP'
          : 'INVITE_EXPIRED';

  return {
    id: user.id,
    userId: user.userId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    createdAt: user.createdAt,
    adminStatus,
    // Only meaningful while a setup link is outstanding.
    inviteExpiresAt: adminStatus === 'AWAITING_SETUP' ? inviteExpiresAt : null,
  };
}

/** The live setup link per user, for the admins on this page who lack a password. */
async function pendingInvites(users: UserRow[]): Promise<Map<string, Date>> {
  const waiting = users.filter((u) => u.role === 'ADMIN' && !u.passwordHash).map((u) => u.userId);
  if (waiting.length === 0) return new Map();

  const tokens = await prisma.adminAuthToken.findMany({
    where: {
      userId: { in: waiting },
      purpose: 'SETUP',
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { userId: true, expiresAt: true },
  });

  return new Map(tokens.map((t) => [t.userId, t.expiresAt]));
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
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.userProfile.count({ where }),
  ]);

  const invites = await pendingInvites(users as UserRow[]);

  return {
    data: (users as UserRow[]).map((u) => toAdminUserDto(u, invites.get(u.userId) ?? null)),
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

  const updated = (await prisma.userProfile.update({
    where: { id: profileId },
    data: { role: input.role },
    select: USER_SELECT,
  })) as UserRow;

  const promoted = target.role !== 'ADMIN' && input.role === 'ADMIN';
  const demoted = target.role === 'ADMIN' && input.role !== 'ADMIN';

  // A new admin has no password yet, so mail them a link to choose one. Someone
  // being re-promoted keeps the password they already set — no email needed.
  if (promoted && !target.passwordHash) {
    try {
      const expiresAt = await issueSetupToken(target.userId, target.email, target.firstName);
      // Returning the resolved status means the row updates in place to
      // "awaiting setup" without the console having to refetch the page.
      return { ...toAdminUserDto(updated, expiresAt), setupEmailSent: true };
    } catch (err) {
      // The promotion itself stands; the console reports the failed invite so
      // an admin can retry, and the new admin can request a link themselves.
      globalLog.error('Failed to send admin setup email', {
        userId: target.userId,
        message: (err as Error)?.message,
      });
      return { ...toAdminUserDto(updated, null), setupEmailSent: false };
    }
  }

  if (demoted) await revokeAdminAccess(target.userId);

  return toAdminUserDto(updated, null);
}

/**
 * Sends a fresh setup link to an admin who has not chosen a password yet, for
 * when the first email was lost or its 24 hours ran out. Without this the only
 * remedy is to demote and re-promote.
 */
export async function resendSetupLink(adminUserId: string, profileId: string) {
  await assertCanManageAdmins(adminUserId);

  const target = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: { userId: true, email: true, firstName: true, role: true, passwordHash: true },
  });

  if (!target) throw createError(404, 'User not found');
  if (target.role !== 'ADMIN') throw createError(400, 'This user is not an admin');

  // Refuse rather than quietly issuing a link that could take over a working
  // account. An admin who forgot their password uses the reset flow instead.
  if (target.passwordHash) throw createError(400, 'This admin has already set a password');

  try {
    const expiresAt = await issueSetupToken(target.userId, target.email, target.firstName);
    return { sent: true, expiresAt };
  } catch (err) {
    globalLog.error('Failed to resend admin setup email', {
      userId: target.userId,
      message: (err as Error)?.message,
    });
    // Confirming the send is the whole point of the action, so a mail failure
    // is reported rather than returning a success the admin cannot trust.
    throw createError(502, 'Could not send the setup email. Please try again.');
  }
}
