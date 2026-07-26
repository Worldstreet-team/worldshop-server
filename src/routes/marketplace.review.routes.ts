import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { updateReviewSchema, vendorReplySchema } from '../validators/marketplace.review.validator';
import * as reviewController from '../controllers/marketplace.review.controller';

/**
 * Operations on an existing review, by review id.
 *
 * Creating and listing reviews are listing-scoped and live on the listings
 * router instead, since a review only exists in the context of a listing.
 */
const router = Router();

router.patch('/:id', requireAuth, validate(updateReviewSchema), reviewController.update);
router.delete('/:id', requireAuth, reviewController.remove);

// The vendor's right of reply — their only answer to an unfair review, since
// they have no refund or resolution lever in this model.
router.post('/:id/reply', requireAuth, validate(vendorReplySchema), reviewController.reply);
router.delete('/:id/reply', requireAuth, reviewController.removeReply);

export default router;
