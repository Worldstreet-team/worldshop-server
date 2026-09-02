import { Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import * as mallService from '../services/mall.service';
import * as mallSubscriptionService from '../services/mall.subscription.service';
import * as subscriptionService from '../services/subscription.service';
import { mallQuerySchema } from '../validators/mall.validator';

function requireUserId(req: Request): string {
  if (!req.user?.id) throw createError(401, 'Authentication required');
  return req.user.id;
}

/**
 * POST /api/v1/malls
 * Create the authenticated user's mall. Starts in DRAFT — not visible to
 * buyers until the subscription is paid.
 */
export const create = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.createMall(requireUserId(req), req.body);

  res.status(201).json({
    success: true,
    data: mall,
    message: 'Mall created. Activate your subscription to make it visible to buyers.',
  });
});

/** GET /api/v1/malls/me */
export const getMine = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.getMyMall(requireUserId(req));
  res.status(200).json({ success: true, data: mall });
});

/** PATCH /api/v1/malls/me */
export const updateMine = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.updateMyMall(requireUserId(req), req.body);
  res.status(200).json({ success: true, data: mall, message: 'Mall updated' });
});

/** GET /api/v1/malls/plans — public pricing */
export const listPlans = catchAsync(async (_req: Request, res: Response) => {
  const plans = await subscriptionService.getActivePlans('MALL');
  res.status(200).json({ success: true, data: plans });
});

/** GET /api/v1/malls/me/subscription */
export const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.getMyMall(requireUserId(req));
  const subscription = await mallSubscriptionService.getSubscriptionForMall(mall.id);
  res.status(200).json({ success: true, data: subscription });
});

/**
 * POST /api/v1/malls/me/subscription/charge
 * Pays the current period. A declined charge is a 402, not a 500 — the
 * request worked, the wallet just did not have the money.
 */
export const chargeMySubscription = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.getMyMall(requireUserId(req));
  const outcome = await mallSubscriptionService.chargeMallSubscription(mall.id);

  if (!outcome.charged) {
    const insufficient = outcome.code === 'INSUFFICIENT_BALANCE';
    res.status(insufficient ? 402 : 502).json({
      success: false,
      code: outcome.code,
      message: insufficient
        ? 'Not enough balance in your WorldStreet dollar wallet. Top up and try again.'
        : `Could not complete the charge: ${outcome.message}`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    data: { periodEnd: outcome.periodEnd, alreadyPaid: outcome.alreadyPaid },
    message: outcome.alreadyPaid
      ? 'This period is already paid for.'
      : 'Subscription active — your mall and its substores are now visible to buyers.',
  });
});

/** POST /api/v1/malls/me/subscription/cancel */
export const cancelMySubscription = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.getMyMall(requireUserId(req));
  const subscription = await mallSubscriptionService.cancelMallSubscription(mall.id);

  res.status(200).json({
    success: true,
    data: subscription,
    message: 'Auto-renewal stopped. Your mall stays visible until the end of the paid period.',
  });
});

/** PUT /api/v1/malls/me/featured */
export const setFeatured = catchAsync(async (req: Request, res: Response) => {
  const mall = await mallService.setFeaturedListings(requireUserId(req), req.body.listingIds);
  res.status(200).json({
    success: true,
    data: { featuredListingIds: mall.featuredListingIds },
    message: 'Featured products updated',
  });
});

/** GET /api/v1/malls/me/substores */
export const listSubstores = catchAsync(async (req: Request, res: Response) => {
  const substores = await mallService.listMySubstores(requireUserId(req));
  res.status(200).json({ success: true, data: substores });
});

/** POST /api/v1/malls/me/substores */
export const createSubstore = catchAsync(async (req: Request, res: Response) => {
  const substore = await mallService.createSubstore(requireUserId(req), req.body);
  res.status(201).json({ success: true, data: substore, message: 'Store created' });
});

/** GET /api/v1/malls/me/substores/:substoreId */
export const getSubstore = catchAsync(async (req: Request, res: Response) => {
  const substore = await mallService.getOwnedSubstore(
    requireUserId(req),
    String(req.params.substoreId),
  );
  res.status(200).json({ success: true, data: substore });
});

/** PATCH /api/v1/malls/me/substores/:substoreId */
export const updateSubstore = catchAsync(async (req: Request, res: Response) => {
  const substore = await mallService.updateSubstore(
    requireUserId(req),
    String(req.params.substoreId),
    req.body,
  );
  res.status(200).json({ success: true, data: substore, message: 'Store updated' });
});

/** DELETE /api/v1/malls/me/substores/:substoreId */
export const archiveSubstore = catchAsync(async (req: Request, res: Response) => {
  const result = await mallService.archiveSubstore(
    requireUserId(req),
    String(req.params.substoreId),
  );
  res.status(200).json({
    success: true,
    data: result,
    message: result.deleted
      ? 'Substore deleted.'
      : 'Substore archived — it had history worth keeping, so it was hidden instead of deleted.',
  });
});

/** POST /api/v1/malls/me/substores/:substoreId/restore */
export const restoreSubstore = catchAsync(async (req: Request, res: Response) => {
  const substore = await mallService.restoreSubstore(
    requireUserId(req),
    String(req.params.substoreId),
  );
  res.status(200).json({ success: true, data: substore, message: 'Store restored' });
});

/**
 * GET /api/v1/malls/me/listings — every listing across the mall's substores.
 * One call for the featured picker instead of one per substore.
 */
export const listMallListings = catchAsync(async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const listings = await mallService.listMallListings(requireUserId(req), {
    status: status as 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'REMOVED' | undefined,
  });
  res.status(200).json({ success: true, data: listings });
});

/** GET /api/v1/malls — public directory of paid-up malls */
export const listPublic = catchAsync(async (req: Request, res: Response) => {
  const query = mallQuerySchema.parse(req.query);
  const { malls, total } = await mallService.listPublicMalls(query);

  res.status(200).json({
    success: true,
    data: malls,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/** GET /api/v1/malls/:slug — public mall page (branding, substores, featured) */
export const getBySlug = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const mall = await mallService.getPublicMallBySlug(String(req.params.slug));
  if (!mall) return next(createError(404, 'Mall not found'));

  res.status(200).json({ success: true, data: mall });
});
