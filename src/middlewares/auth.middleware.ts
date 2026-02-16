import { Request, Response, NextFunction } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import prisma from '../configs/prismaConfig';

/**
 * requireAuth — Protects routes that need an authenticated user.
 * Uses Clerk to verify the session token and attaches user info to req.user.
 * Also fetches the role from the UserProfile in our database.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = getAuth(req);

    if (!auth?.userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
      });
      return;
    }

    // Fetch Clerk user details for name/email
    const clerkUser = await clerkClient.users.getUser(auth.userId);

    // Fetch role from our database
    const profile = await prisma.userProfile.findUnique({
      where: { userId: auth.userId },
      select: { role: true },
    });

    req.user = {
      id: auth.userId,
      email: clerkUser.emailAddresses?.[0]?.emailAddress || '',
      firstName: clerkUser.firstName || '',
      lastName: clerkUser.lastName || '',
      role: (profile?.role as 'CUSTOMER' | 'ADMIN') || 'CUSTOMER',
    };

    next();
  } catch (err) {
    res.status(401).json({
      success: false,
      message: 'Invalid session. Please log in again.',
    });
  }
}

/**
 * optionalAuth — Attempts to authenticate but does NOT reject
 * unauthenticated requests. Use for routes that behave differently
 * for logged-in vs guest users (e.g. cart, product reviews).
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = getAuth(req);

    if (auth?.userId) {
      const clerkUser = await clerkClient.users.getUser(auth.userId);

      const profile = await prisma.userProfile.findUnique({
        where: { userId: auth.userId },
        select: { role: true },
      });

      req.user = {
        id: auth.userId,
        email: clerkUser.emailAddresses?.[0]?.emailAddress || '',
        firstName: clerkUser.firstName || '',
        lastName: clerkUser.lastName || '',
        role: (profile?.role as 'CUSTOMER' | 'ADMIN') || 'CUSTOMER',
      };
    }
  } catch {
    // Session invalid — proceed as guest
  }

  next();
}
