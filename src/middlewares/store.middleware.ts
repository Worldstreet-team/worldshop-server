import { Request, Response, NextFunction } from 'express';
import prisma from '../configs/prismaConfig';

/**
 * requireStore — must run AFTER requireAuth.
 *
 * Replaces `requireVendor` for the marketplace model. Owning a store is what
 * makes someone a vendor now, so this resolves the caller's store instead of
 * reading the legacy `isVendor` flag off the identity JWT — a flag that is
 * never set for anyone who signed up after the pivot.
 *
 * Deliberately does NOT require a paid subscription. An unpaid vendor must be
 * able to build their catalogue before they are asked for money; the paywall
 * gates who can *see* the listings, not who can create them.
 */
export async function requireStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const store = await prisma.store.findUnique({
    where: { ownerId: req.user.id },
    select: { id: true, slug: true, status: true, state: true, city: true },
  });

  if (!store) {
    res.status(403).json({
      success: false,
      code: 'NO_STORE',
      message: 'Create a store before managing listings.',
    });
    return;
  }

  if (store.status === 'BANNED' || store.status === 'SUSPENDED') {
    res.status(403).json({
      success: false,
      code: store.status,
      message:
        store.status === 'BANNED'
          ? 'This store has been banned.'
          : 'This store is suspended. Contact support.',
    });
    return;
  }

  req.store = store;
  next();
}
