import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireMall, requireSubstore } from '../middlewares/store.middleware';
import {
  createMallSchema,
  updateMallSchema,
  createSubstoreSchema,
  updateSubstoreSchema,
  setFeaturedSchema,
} from '../validators/mall.validator';
import { createListingSchema, updateListingSchema } from '../validators/listing.validator';
import * as mallController from '../controllers/mall.controller';
import * as listingController from '../controllers/listing.controller';
import * as uploadController from '../controllers/upload.controller';
import {
  uploadProductImages as uploadListingImages,
  handleMulterError,
} from '../middlewares/upload.middleware';

const router = Router();

// ─── Public ─────────────────────────────────────────────────────
// Plans are public so pricing can be shown before signup.
router.get('/plans', mallController.listPlans);
router.get('/', mallController.listPublic);

// ─── Owner ──────────────────────────────────────────────────────
// Only requireAuth: creating a mall is how a user becomes a mall owner.
router.post('/', requireAuth, validate(createMallSchema), mallController.create);
router.get('/me', requireAuth, mallController.getMine);
router.patch('/me', requireAuth, validate(updateMallSchema), mallController.updateMine);

router.get('/me/subscription', requireAuth, mallController.getMySubscription);
router.post('/me/subscription/charge', requireAuth, mallController.chargeMySubscription);
router.post('/me/subscription/cancel', requireAuth, mallController.cancelMySubscription);

// Branding upload for the mall itself. The substore equivalent rides on the
// substore's listing router below; the mall has no listings of its own, so it
// needs its own mount. requireMall, not just requireAuth: there is nothing to
// brand until the mall exists.
router.post(
  '/me/upload/images',
  requireAuth,
  requireMall,
  uploadListingImages,
  handleMulterError,
  uploadController.uploadImages,
);
router.delete('/me/upload/images', requireAuth, requireMall, uploadController.deleteImages);

router.put(
  '/me/featured',
  requireAuth,
  requireMall,
  validate(setFeaturedSchema),
  mallController.setFeatured,
);

// ─── Substores (owner) ──────────────────────────────────────────
// Aggregate catalogue view — declared before the :substoreId routes.
router.get('/me/listings', requireAuth, requireMall, mallController.listMallListings);
router.get('/me/substores', requireAuth, requireMall, mallController.listSubstores);
router.post(
  '/me/substores',
  requireAuth,
  requireMall,
  validate(createSubstoreSchema),
  mallController.createSubstore,
);
router.get('/me/substores/:substoreId', requireAuth, requireMall, mallController.getSubstore);
router.patch(
  '/me/substores/:substoreId',
  requireAuth,
  requireMall,
  validate(updateSubstoreSchema),
  mallController.updateSubstore,
);
router.delete('/me/substores/:substoreId', requireAuth, requireMall, mallController.archiveSubstore);
router.post(
  '/me/substores/:substoreId/restore',
  requireAuth,
  requireMall,
  mallController.restoreSubstore,
);

// ─── Substore listings (owner) ──────────────────────────────────
// requireSubstore resolves :substoreId and sets req.store, so the existing
// listing controllers manage substore catalogues without knowing malls exist.
// mergeParams carries :substoreId into the sub-router.
const listings = Router({ mergeParams: true });
listings.use(requireAuth, requireMall, requireSubstore);

listings.post('/upload/images', uploadListingImages, handleMulterError, uploadController.uploadImages);
listings.delete('/upload/images', uploadController.deleteImages);

listings.get('/form-spec', listingController.formSpec);
listings.get('/', listingController.listMine);
listings.post('/', validate(createListingSchema), listingController.create);
listings.get('/:id', listingController.getMine);
listings.patch('/:id', validate(updateListingSchema), listingController.update);
listings.delete('/:id', listingController.remove);
listings.post('/:id/publish', listingController.publish);
listings.post('/:id/unpublish', listingController.unpublish);

router.use('/me/substores/:substoreId/listings', listings);

// Declared last so it cannot shadow /plans or /me.
router.get('/:slug', mallController.getBySlug);

export default router;
