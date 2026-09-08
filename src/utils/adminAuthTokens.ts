import { randomBytes, createHash } from 'node:crypto';
import { ADMIN_SESSION_TTL_HOURS } from '../configs/envConfig';

/**
 * Token helpers for admin credential auth.
 *
 * Only the sha256 hash of a token is ever persisted. The raw value exists in
 * one email or one cookie and nowhere else, so a dump of AdminAuthToken or
 * AdminSession cannot be replayed. Hashing is plain sha256 rather than bcrypt
 * on purpose: these are 256-bit random values, not guessable secrets, so there
 * is nothing for a slow hash to protect against and the lookup stays a single
 * indexed query.
 */

/** A setup link has to survive a working day plus a night of not checking email. */
export const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Resets are requested and used within minutes; keep the window tight. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Fixed session lifetime — no sliding renewal, so a stolen cookie has a hard stop. */
export const SESSION_TTL_MS = sessionTtlMs();

function sessionTtlMs(): number {
  const hours = Number(ADMIN_SESSION_TTL_HOURS);
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 24 * 7;
  return safe * 60 * 60 * 1000;
}

/** The admin console's session cookie. */
export const ADMIN_SESSION_COOKIE = 'admin_session';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Returns the raw token (to send) alongside the hash (to store). */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}

export function expiresIn(ms: number): Date {
  return new Date(Date.now() + ms);
}
