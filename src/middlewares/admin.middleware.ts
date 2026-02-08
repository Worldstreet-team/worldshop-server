import { Request, Response, NextFunction } from 'express';

/**
 * requireAdmin — Must be used AFTER requireAuth.
 * Checks that the authenticated user has the ADMIN role.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({
      success: false,
      message: 'Admin access required.',
    });
    return;
  }

  next();
}
