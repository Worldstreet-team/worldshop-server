import { Router, Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { createReviewSchema } from '../validators/marketplace.review.validator';
import * as listingService from '../services/listing.service';
import * as reviewController from '../controllers/marketplace.review.controller';

const router = Router();

/**
 * GET /api/v1/listings
 * Public browse. Filters:
 *   categoryId, state, search, page, limit
 *   attr.<Name>=<Value>  — faceted filter on the structured attribute layer,
 *                          e.g. ?attr.Size=XL&attr.Condition=New
 *
 * Only the admin-defined attributes are filterable. Vendor custom fields are
 * intentionally not searchable here: free-form labels have no shared
 * vocabulary, so a "Colour" facet would fragment across every spelling
 * vendors happen to use.
 */
router.get(
  '/',
  catchAsync(async (req: Request, res: Response) => {
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (key.startsWith('attr.') && typeof value === 'string') {
        attributes[key.slice(5)] = value;
      }
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const { listings, total } = await listingService.listPublicListings({
      page,
      limit,
      categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
      state: typeof req.query.state === 'string' ? req.query.state : undefined,
      condition: typeof req.query.condition === 'string' ? req.query.condition : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      attributes,
    });

    res.status(200).json({
      success: true,
      data: listings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }),
);

/**
 * GET /api/v1/listings/:idOrSlug
 * A single public listing. Declared after the review routes below would be a
 * bug — but those are more specific paths, so ordering is safe either way.
 */
router.get(
  '/:idOrSlug',
  catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const listing = await listingService.getPublicListing(String(req.params.idOrSlug));
    if (!listing) return next(createError(404, 'Listing not found'));

    res.status(200).json({ success: true, data: listing });
  }),
);

// ─── Reviews on a listing ───────────────────────────────────────
// Anchored to chat: reviewing requires having messaged the seller about this
// item, and the verified badge requires that they replied.
router.get('/:id/reviews', reviewController.listForListing);
router.get('/:id/reviews/eligibility', requireAuth, reviewController.eligibility);
router.get('/:id/reviews/mine', requireAuth, reviewController.mine);
router.post('/:id/reviews', requireAuth, validate(createReviewSchema), reviewController.create);

export default router;
