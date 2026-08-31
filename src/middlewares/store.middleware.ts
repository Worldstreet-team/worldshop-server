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

  const store = await prisma.store.findFirst({
    where: { ownerId: req.user.id, kind: 'PERSONAL' },
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

/**
 * requireMall — must run AFTER requireAuth. Resolves the caller's mall the way
 * requireStore resolves their personal store. Same deliberate choice not to
 * require a paid subscription: an unpaid mall owner can build out substores
 * and catalogues; the paywall gates visibility, not authoring.
 */
export async function requireMall(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const mall = await prisma.mall.findUnique({
    where: { ownerId: req.user.id },
    select: { id: true, slug: true, status: true, state: true, city: true },
  });

  if (!mall) {
    res.status(403).json({
      success: false,
      code: 'NO_MALL',
      message: 'Create a mall before managing substores.',
    });
    return;
  }

  if (mall.status === 'BANNED' || mall.status === 'SUSPENDED') {
    res.status(403).json({
      success: false,
      code: mall.status,
      message:
        mall.status === 'BANNED'
          ? 'This mall has been banned.'
          : 'This mall is suspended. Contact support.',
    });
    return;
  }

  req.mall = mall;
  next();
}

/**
 * requireSubstore — must run AFTER requireMall. Resolves `:substoreId` to one
 * of the caller's mall's substores and sets it as `req.store`, so the existing
 * listing controllers (which only look at req.store) manage substore listings
 * without knowing malls exist.
 */
export async function requireSubstore(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.mall) {
    res.status(500).json({ success: false, message: 'requireSubstore used without requireMall.' });
    return;
  }

  // Validate before querying: a malformed id makes Prisma-on-Mongo throw
  // ("Malformed ObjectID"), turning a bad URL into a 500.
  const substoreId = String(req.params.substoreId);
  if (!/^[0-9a-f]{24}$/.test(substoreId)) {
    res.status(404).json({ success: false, message: 'Substore not found.' });
    return;
  }

  const substore = await prisma.store.findFirst({
    where: { id: substoreId, mallId: req.mall.id, kind: 'MALL_SUBSTORE' },
    select: { id: true, slug: true, status: true, state: true, city: true },
  });

  if (!substore) {
    res.status(404).json({ success: false, message: 'Substore not found.' });
    return;
  }

  // DRAFT means the owner archived this substore — its plan slot was given
  // back, so its catalogue must not stay writable. Restore it first.
  if (substore.status === 'DRAFT') {
    res.status(409).json({
      success: false,
      code: 'SUBSTORE_ARCHIVED',
      message: 'This substore is archived. Restore it before managing its listings.',
    });
    return;
  }

  // Substores inherit the mall's standing (checked by requireMall); their own
  // status otherwise only reflects the mall's billing state, which must not
  // block authoring — the same rule as requireStore's unpaid-vendor stance.
  req.store = substore;
  next();
}
