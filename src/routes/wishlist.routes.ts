import { Router } from 'express';
import * as wishlistController from '../controllers/wishlist.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// All wishlist routes require authentication
router.use(requireAuth);

router.get('/', wishlistController.getWishlist);
router.post('/items', wishlistController.addToWishlist);
router.delete('/items/:productId', wishlistController.removeFromWishlist);
router.get('/check/:productId', wishlistController.checkWishlist);

export default router;
