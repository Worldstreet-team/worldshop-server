import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ACCESS_SECRET } from '../configs/envConfig';
import type { JwtPayload } from '../types/express';

/**
 * Extract the Bearer token from the Authorization header or cookie.
 */
function extractToken(req: Request): string | null {
  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. Check cookies (HttpOnly accessToken set by the auth service)
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
}

/**
 * requireAuth — Protects routes that need an authenticated user.
 * Verifies the JWT locally using the shared secret and attaches
 * the decoded payload to req.user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET as string) as Record<string, unknown>;

    // Map the decoded JWT to our JwtPayload shape.
    // WorldStreet Identity may use _id, userId, sub, or id — normalise here.
    const userId = (decoded.id || decoded._id || decoded.userId || decoded.sub) as string | undefined;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Invalid token payload: no user ID found.',
        _debug_keys: Object.keys(decoded), // temporary — remove after confirming
      });
      return;
    }

    req.user = {
      id: userId,
      email: (decoded.email as string) || '',
      firstName: (decoded.firstName as string) || (decoded.first_name as string) || '',
      lastName: (decoded.lastName as string) || (decoded.last_name as string) || '',
      role: ((decoded.role as string) || 'CUSTOMER').toUpperCase() as 'CUSTOMER' | 'ADMIN',
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        message: 'Token expired. Please refresh your session.',
      });
      return;
    }

    res.status(401).json({
      success: false,
      message: 'Invalid token. Please log in again.',
    });
  }
}

/**
 * optionalAuth — Attempts to authenticate but does NOT reject
 * unauthenticated requests. Use for routes that behave differently
 * for logged-in vs guest users (e.g. cart, product reviews).
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET as string) as Record<string, unknown>;
    const userId = (decoded.id || decoded._id || decoded.userId || decoded.sub) as string | undefined;

    if (userId) {
      req.user = {
        id: userId,
        email: (decoded.email as string) || '',
        firstName: (decoded.firstName as string) || (decoded.first_name as string) || '',
        lastName: (decoded.lastName as string) || (decoded.last_name as string) || '',
        role: ((decoded.role as string) || 'CUSTOMER').toUpperCase() as 'CUSTOMER' | 'ADMIN',
      };
    }
  } catch {
    // Token invalid/expired — proceed as guest
  }

  next();
}
