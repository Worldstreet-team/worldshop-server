import { Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import * as listingService from '../services/listing.service';
import { listingQuerySchema } from '../validators/listing.validator';

function store(req: Request) {
  if (!req.store) throw createError(500, 'requireStore did not run');
  return req.store;
}

/** GET /api/v1/stores/me/listings */
export const listMine = catchAsync(async (req: Request, res: Response) => {
  const query = listingQuerySchema.parse(req.query);
  const { listings, total } = await listingService.listMyListings(store(req).id, query);

  res.status(200).json({
    success: true,
    data: listings,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/** GET /api/v1/stores/me/listings/:id */
export const getMine = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const listing = await listingService.getMyListing(store(req).id, String(req.params.id));
  if (!listing) return next(createError(404, 'Listing not found'));

  res.status(200).json({ success: true, data: listing });
});

/**
 * POST /api/v1/stores/me/listings
 * Creates a DRAFT. Nothing is public until the vendor publishes AND the store
 * subscription is paid.
 */
export const create = catchAsync(async (req: Request, res: Response) => {
  const listing = await listingService.createListing(store(req), req.body);

  res.status(201).json({
    success: true,
    data: listing,
    message: 'Draft saved. Publish it when you are ready.',
  });
});

/** PATCH /api/v1/stores/me/listings/:id */
export const update = catchAsync(async (req: Request, res: Response) => {
  const listing = await listingService.updateListing(store(req).id, String(req.params.id), req.body);
  res.status(200).json({ success: true, data: listing, message: 'Listing updated' });
});

/**
 * POST /api/v1/stores/me/listings/:id/publish
 * Enforces the category's listing standards, then marks it ready. Reports
 * whether it is actually live, which depends on the subscription.
 */
export const publish = catchAsync(async (req: Request, res: Response) => {
  const result = await listingService.publishListing(store(req), String(req.params.id));

  res.status(200).json({
    success: true,
    data: { listing: result.listing, publiclyVisible: result.publiclyVisible },
    message: result.message,
  });
});

/** POST /api/v1/stores/me/listings/:id/unpublish */
export const unpublish = catchAsync(async (req: Request, res: Response) => {
  const listing = await listingService.unpublishListing(store(req).id, String(req.params.id));
  res.status(200).json({ success: true, data: listing, message: 'Listing hidden from buyers' });
});

/** DELETE /api/v1/stores/me/listings/:id */
export const remove = catchAsync(async (req: Request, res: Response) => {
  await listingService.deleteListing(store(req).id, String(req.params.id));
  res.status(200).json({ success: true, message: 'Listing deleted' });
});

/**
 * GET /api/v1/stores/me/listings/form-spec?categoryId=
 * The dynamic-form contract for a category: required attributes, allowed
 * values, and which are filterable. The vendor UI renders itself from this
 * rather than hardcoding fields per category.
 */
export const formSpec = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const categoryId = req.query.categoryId;
  if (typeof categoryId !== 'string' || categoryId.length !== 24) {
    return next(createError(400, 'A valid categoryId is required'));
  }

  const spec = await listingService.getCategoryFormSpec(categoryId);
  res.status(200).json({ success: true, data: spec });
});
