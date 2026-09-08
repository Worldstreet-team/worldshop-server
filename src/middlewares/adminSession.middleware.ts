import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { ADMIN_SESSION_COOKIE } from '../utils/adminAuthTokens';
import { sessionCookieOptions } from '../controllers/auth.controller';

/**
 * requireAdminSession — the gate on the admin console.
 *
 * Replaces requireAuth + requireAdmin on /api/v1/admin. It reads the session
 * cookie instead of a Clerk bearer token, but fills req.user with the same
 * shape (id = UserProfile.userId), so the admin services behind it are
 * unchanged. The role is checked against the database on every request, so a
 * demotion takes effect immediately rather than at session expiry.
 */
export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw = req.cookies?.[ADMIN_SESSION_COOKIE];

    if (!raw) {
      res.status(401).json({
        success: false,
        message: 'Admin authentication required. Please sign in.',
      });
      return;
    }

    const user = await authService.getSessionUser(raw);

    if (!user) {
      res.clearCookie(ADMIN_SESSION_COOKIE, sessionCookieOptions(req));
      res.status(401).json({
        success: false,
        message: 'Your admin session has expired. Please sign in again.',
      });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid admin session. Please sign in again.',
    });
  }
}
