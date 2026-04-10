import { Request, Response, NextFunction } from 'express';

/**
 * requireVendor — Must be used AFTER requireAuth.
 * Checks that the authenticated user is an active vendor.
 * No extra DB call — reads from req.user set by requireAuth.
 */
export function requireVendor(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
    return;
  }

  if (!req.user.isVendor) {
    res.status(403).json({
      success: false,
      message: 'Vendor access required.',
    });
    return;
  }

  if (req.user.vendorStatus === 'BANNED') {
    res.status(403).json({
      success: false,
      message: 'Your vendor account has been banned.',
    });
    return;
  }

  if (req.user.vendorStatus === 'SUSPENDED') {
    // Allow read-only access — only GET requests pass through
    if (req.method !== 'GET') {
      res.status(403).json({
        success: false,
        message: 'Your vendor account is suspended. Read-only access.',
      });
      return;
    }
  }

  next();
}
