import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { requireStore } from '../middlewares/store.middleware';
import { createStoreSchema, updateStoreSchema } from '../validators/store.validator';
import { createListingSchema, updateListingSchema } from '../validators/listing.validator';
import * as storeController from '../controllers/marketplace.store.controller';
import * as listingController from '../controllers/listing.controller';
import * as reviewController from '../controllers/marketplace.review.controller';
import * as uploadController from '../controllers/upload.controller';
import {
  uploadProductImages as uploadListingImages,
  handleMulterError,
} from '../middlewares/upload.middleware';

const router = Router();

// ─── Public ─────────────────────────────────────────────────────
// Plans are public so pricing can be shown before signup.
router.get('/plans', storeController.listPlans);
router.get('/', storeController.listPublic);

// ─── Owner ──────────────────────────────────────────────────────
// Only requireAuth: creating a store is how a user *becomes* a vendor, so
// requireVendor (which reads the legacy isVendor flag) must not gate this.
router.post('/', requireAuth, validate(createStoreSchema), storeController.create);
router.get('/me', requireAuth, storeController.getMine);
router.patch('/me', requireAuth, validate(updateStoreSchema), storeController.updateMine);

router.get('/me/dashboard', requireAuth, storeController.dashboard);
// requireStore, not requireAuth: this reads the caller's own store regardless
// of whether it is currently visible to buyers.
router.get('/me/reviews', requireAuth, requireStore, reviewController.listMine);
router.get('/me/subscription', requireAuth, storeController.getMySubscription);
router.post('/me/subscription/charge', requireAuth, storeController.chargeMySubscription);
router.post('/me/subscription/cancel', requireAuth, storeController.cancelMySubscription);

// ─── Listings (owner) ───────────────────────────────────────────
// requireStore, not requireVendor: owning a store is what makes someone a
// vendor now. It deliberately does not require a paid subscription — vendors
// build their catalogue first, and the paywall gates visibility, not authoring.
const listings = Router();
listings.use(requireAuth, requireStore);

// Image upload for listings. The legacy upload routes sit behind
// `requireVendor`, which reads the identity JWT's `isVendor` flag — now false
// for everyone since Store became the source of truth. Without these a store
// owner cannot upload a photo, and publish requires at least one image, so the
// whole flow is blocked.
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

router.use('/me/listings', listings);

// Store reputation page and catalogue — declared before /:slug so the param
// route does not shadow them.
router.get('/:slug/reviews', reviewController.listForStore);
router.get('/:slug/listings', storeController.publicStoreListings);

// Declared last so it cannot shadow /plans or /me.
router.get('/:slug', storeController.getBySlug);

export default router;
