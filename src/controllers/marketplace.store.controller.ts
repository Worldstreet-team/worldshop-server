import { Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import * as storeService from '../services/marketplace.store.service';
import * as subscriptionService from '../services/subscription.service';
import * as dashboardService from '../services/store.dashboard.service';
import * as listingService from '../services/listing.service';
import { storeQuerySchema } from '../validators/store.validator';

function requireUserId(req: Request): string {
  if (!req.user?.id) throw createError(401, 'Authentication required');
  return req.user.id;
}

/**
 * POST /api/v1/stores
 * Create the authenticated user's store. Starts in DRAFT — not visible to
 * buyers until the subscription is paid.
 */
export const create = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const store = await storeService.createStore(requireUserId(req), req.body);

  res.status(201).json({
    success: true,
    data: store,
    message: 'Store created. Activate your subscription to make it visible to buyers.',
  });
});

/** GET /api/v1/stores/me */
export const getMine = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.getMyStore(requireUserId(req));
  res.status(200).json({ success: true, data: store });
});

/** PATCH /api/v1/stores/me */
export const updateMine = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.updateStore(requireUserId(req), req.body);
  res.status(200).json({ success: true, data: store, message: 'Store updated' });
});

/** GET /api/v1/stores/plans — public pricing */
export const listPlans = catchAsync(async (_req: Request, res: Response) => {
  const plans = await subscriptionService.getActivePlans();
  res.status(200).json({ success: true, data: plans });
});

/**
 * GET /api/v1/stores/me/dashboard
 * Everything the vendor landing page needs in one call: whether the store is
 * visible and until when, plus the evidence the subscription is doing
 * something. Six round-trips for one screen is how dashboards get slow.
 */
export const dashboard = catchAsync(async (req: Request, res: Response) => {
  const data = await dashboardService.getDashboard(requireUserId(req));
  res.status(200).json({ success: true, data });
});

/** GET /api/v1/stores/me/subscription */
export const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.getMyStore(requireUserId(req));
  const subscription = await subscriptionService.getSubscriptionForStore(store.id);
  res.status(200).json({ success: true, data: subscription });
});

/**
 * POST /api/v1/stores/me/subscription/charge
 * Pays the current period — first activation, or a retry after a failed
 * renewal. A declined charge is a 402, not a 500: the request worked, the
 * wallet just did not have the money.
 */
export const chargeMySubscription = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.getMyStore(requireUserId(req));
  const outcome = await subscriptionService.chargeSubscription(store.id);

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
      : 'Subscription active — your store is now visible to buyers.',
  });
});

/** POST /api/v1/stores/me/subscription/cancel */
export const cancelMySubscription = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.getMyStore(requireUserId(req));
  const subscription = await subscriptionService.cancelSubscription(store.id);

  res.status(200).json({
    success: true,
    data: subscription,
    message: 'Auto-renewal stopped. Your store stays visible until the end of the paid period.',
  });
});

/** GET /api/v1/stores — public directory of paid-up stores */
export const listPublic = catchAsync(async (req: Request, res: Response) => {
  const query = storeQuerySchema.parse(req.query);
  const { stores, total } = await storeService.listPublicStores(query);

  res.status(200).json({
    success: true,
    data: stores,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/**
 * GET /api/v1/stores/:slug/listings — a store's public catalogue.
 * Resolves the slug through the same visibility rule as the store page, so an
 * unpaid store's catalogue is not reachable by guessing the URL.
 */
export const publicStoreListings = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const store = await storeService.getPublicStoreBySlug(String(req.params.slug));
  if (!store) return next(createError(404, 'Store not found'));

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

  const { listings, total } = await listingService.listStoreListings(store.id, {
    page,
    limit,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
  });

  res.status(200).json({
    success: true,
    data: listings,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

/** GET /api/v1/stores/:slug — public store page */
export const getBySlug = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const store = await storeService.getPublicStoreBySlug(String(req.params.slug));
  if (!store) return next(createError(404, 'Store not found'));

  res.status(200).json({ success: true, data: store });
});
