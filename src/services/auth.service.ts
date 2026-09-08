import createError from 'http-errors';
import bcrypt from 'bcryptjs';
import prisma from '../configs/prismaConfig';
import { globalLog } from '../configs/loggerConfig';
import type { JwtPayload } from '../types/express';
import {
  generateToken,
  hashToken,
  expiresIn,
  SETUP_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  SESSION_TTL_MS,
} from '../utils/adminAuthTokens';
import { sendAdminPasswordResetEmail, sendAdminPasswordSetupEmail } from './email.service';

/**
 * Admin credential auth.
 *
 * The admin console is the one surface that does not use Clerk. Admins sign in
 * with an email and a password they chose through an emailed setup link, and
 * get a server-issued session cookie. Everything else in the app — shoppers,
 * vendors — still authenticates through Clerk and is untouched by this module.
 *
 * No admin ever starts with a known password. A profile promoted to ADMIN has
 * `passwordHash: null` until the person follows their own single-use link, so
 * there is no shared default for an attacker to try against a list of emails.
 */

/**
 * NULLABLE_FIELDS_NOTE — why `usedAt: null` and `revokedAt: null` are written
 * explicitly on every create in this file.
 *
 * Prisma's Mongo connector distinguishes a field holding null from a field that
 * is absent, and `where: { usedAt: null }` matches only the former. Omitting an
 * optional field on create leaves it absent, so the conditional updates that
 * make tokens single-use and sessions revocable would match zero rows and fail
 * silently: every setup link would report itself invalid, and logout would
 * leave the session alive. Verified against the database, not assumed.
 */

const BCRYPT_COST = 12;

/**
 * Compared against when there is no real hash to check, so that "no such user",
 * "not an admin" and "wrong password" all cost one bcrypt round. Without it the
 * response time answers "is this address an admin?" for anyone who asks.
 */
const DUMMY_HASH = bcrypt.hashSync('password-that-is-never-valid', BCRYPT_COST);

/** More than this many links in an hour and we stop mailing — someone is hammering the form. */
const MAX_TOKENS_PER_HOUR = 3;

type AdminProfile = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'ADMIN';
  passwordHash: string | null;
};

const PROFILE_SELECT = {
  userId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  passwordHash: true,
} as const;

function toSessionUser(profile: AdminProfile): JwtPayload {
  // id is UserProfile.userId (the Clerk id), matching what requireAuth sets, so
  // every existing admin service keeps working against req.user unchanged.
  return {
    id: profile.userId,
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    role: profile.role,
  };
}

export type AdminLoginResult =
  | { outcome: 'SESSION'; rawToken: string; expiresAt: Date; user: JwtPayload }
  | { outcome: 'SETUP_REQUIRED' };

/**
 * Verifies credentials and opens a session.
 *
 * An admin who has not set a password yet is told so and mailed a fresh setup
 * link, rather than getting a wrong-password error they can do nothing about.
 * That does reveal "this address is an admin without a password" to anyone who
 * guesses it — accepted deliberately: the link only ever lands in the real
 * inbox, the route is rate limited, and the alternative makes every admin's
 * first sign-in a dead end.
 */
export async function adminLogin(email: string, password: string): Promise<AdminLoginResult> {
  const profile = (await prisma.userProfile.findUnique({
    where: { email },
    select: PROFILE_SELECT,
  })) as AdminProfile | null;

  if (!profile || profile.role !== 'ADMIN') {
    await bcrypt.compare(password, DUMMY_HASH);
    throw createError(401, 'Invalid email or password');
  }

  if (!profile.passwordHash) {
    // Throttled, or repeated sign-in attempts would mail a new link each time.
    if (!(await overTokenLimit(profile.userId))) {
      await issueSetupToken(profile.userId, profile.email, profile.firstName).catch((err: unknown) => {
        globalLog.error('Failed to send setup email on login', { message: (err as Error)?.message });
      });
    }
    return { outcome: 'SETUP_REQUIRED' };
  }

  const ok = await bcrypt.compare(password, profile.passwordHash);
  if (!ok) throw createError(401, 'Invalid email or password');

  // Housekeeping ride-along: Prisma cannot declare a Mongo TTL index, so expired
  // rows are swept here rather than by a scheduled job.
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const { raw, hash } = generateToken();
  const expiresAt = expiresIn(SESSION_TTL_MS);

  await prisma.adminSession.create({
    // revokedAt is written explicitly. See NULLABLE_FIELDS_NOTE below: an
    // omitted optional field is absent in Mongo, and `revokedAt: null` does not
    // match an absent field, so revocation would silently never apply.
    data: { userId: profile.userId, tokenHash: hash, expiresAt, revokedAt: null },
  });

  return { outcome: 'SESSION', rawToken: raw, expiresAt, user: toSessionUser(profile) };
}

/**
 * Resolves a session cookie to a user, or null. The role is re-read on every
 * request, so demoting an admin kills their open tabs without needing the
 * revocation sweep to have run first.
 */
export async function getSessionUser(rawToken: string): Promise<JwtPayload | null> {
  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { userId: true, expiresAt: true, revokedAt: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const profile = (await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: PROFILE_SELECT,
  })) as AdminProfile | null;

  if (!profile || profile.role !== 'ADMIN') return null;

  return toSessionUser(profile);
}

export async function logout(rawToken: string): Promise<void> {
  await prisma.adminSession.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Invalidates every unused token of a purpose, so only the newest link works. */
async function supersedeTokens(userId: string, purpose: 'SETUP' | 'RESET'): Promise<void> {
  await prisma.adminAuthToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
}

async function overTokenLimit(userId: string): Promise<boolean> {
  const recent = await prisma.adminAuthToken.count({
    where: { userId, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  return recent >= MAX_TOKENS_PER_HOUR;
}

/**
 * Issues a setup link. Exported because promoting a user to admin needs it too.
 * Throws if the mail fails, so the caller can report it.
 */
export async function issueSetupToken(
  userId: string,
  email: string,
  firstName: string,
): Promise<void> {
  await supersedeTokens(userId, 'SETUP');

  const { raw, hash } = generateToken();
  await prisma.adminAuthToken.create({
    // usedAt written explicitly — see NULLABLE_FIELDS_NOTE.
    data: {
      userId,
      tokenHash: hash,
      purpose: 'SETUP',
      expiresAt: expiresIn(SETUP_TOKEN_TTL_MS),
      usedAt: null,
    },
  });

  await sendAdminPasswordSetupEmail({ to: email, firstName, token: raw });
}

/**
 * Sends whichever link the account actually needs — setup if they have never
 * had a password, reset if they have. Resolves either way: the controller has
 * already replied 200, since both the response body and its timing would
 * otherwise say whether the address belongs to an admin.
 */
export async function forgotPassword(email: string): Promise<void> {
  const profile = (await prisma.userProfile.findUnique({
    where: { email },
    select: PROFILE_SELECT,
  })) as AdminProfile | null;

  if (!profile || profile.role !== 'ADMIN') return;
  if (await overTokenLimit(profile.userId)) return;

  if (!profile.passwordHash) {
    await issueSetupToken(profile.userId, profile.email, profile.firstName);
    return;
  }

  await supersedeTokens(profile.userId, 'RESET');

  const { raw, hash } = generateToken();
  await prisma.adminAuthToken.create({
    // usedAt written explicitly — see NULLABLE_FIELDS_NOTE.
    data: {
      userId: profile.userId,
      tokenHash: hash,
      purpose: 'RESET',
      expiresAt: expiresIn(RESET_TOKEN_TTL_MS),
      usedAt: null,
    },
  });

  await sendAdminPasswordResetEmail({
    to: profile.email,
    firstName: profile.firstName,
    token: raw,
  });
}

/**
 * Claims a link token, atomically. The conditional updateMany is what makes it
 * single-use: two requests racing on the same token both try to move usedAt
 * from null, and Mongo lets exactly one of them match.
 */
async function consumeToken(
  rawToken: string,
  purpose: 'SETUP' | 'RESET',
  invalidMessage: string,
): Promise<string> {
  const tokenHash = hashToken(rawToken);

  const claimed = await prisma.adminAuthToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claimed.count !== 1) throw createError(400, invalidMessage);

  const token = await prisma.adminAuthToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });

  if (!token) throw createError(400, invalidMessage);
  return token.userId;
}

async function applyNewPassword(userId: string, password: string, invalidMessage: string): Promise<void> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { role: true },
  });

  // Demoted between requesting the link and following it.
  if (!profile || profile.role !== 'ADMIN') throw createError(400, invalidMessage);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  await prisma.userProfile.update({
    where: { userId },
    data: { passwordHash, passwordSetAt: new Date() },
  });

  // A new password ends every session and outstanding link — the point of a
  // reset is usually that something else got hold of one of them.
  await revokeAdminAccess(userId);
}

export async function setupPassword(rawToken: string, password: string): Promise<void> {
  const message = 'This setup link is invalid, expired, or has already been used.';
  const userId = await consumeToken(rawToken, 'SETUP', message);
  await applyNewPassword(userId, password, message);
}

export async function resetPassword(rawToken: string, password: string): Promise<void> {
  const message = 'This reset link is invalid, expired, or has already been used.';
  const userId = await consumeToken(rawToken, 'RESET', message);
  await applyNewPassword(userId, password, message);
}

/** Ends every session and kills every outstanding link for a user. */
export async function revokeAdminAccess(userId: string): Promise<void> {
  const now = new Date();

  await Promise.all([
    prisma.adminSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.adminAuthToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
  ]);
}
