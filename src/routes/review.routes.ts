import { Router } from 'express';
import * as reviewController from '../controllers/review.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router({ mergeParams: true }); // mergeParams to access :productId from parent

// Public routes
router.get('/', reviewController.getProductReviews);
router.get('/summary', reviewController.getReviewSummary);

// Authenticated routes
router.get('/mine', requireAuth, reviewController.getMyReview);
router.post('/', requireAuth, reviewController.createReview);
router.put('/:reviewId', requireAuth, reviewController.updateReview);
router.delete('/:reviewId', requireAuth, reviewController.deleteReview);

export default router;
