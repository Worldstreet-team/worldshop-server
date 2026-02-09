import { Router } from 'express';
import * as cartController from '../controllers/cart.controller';
import { optionalAuth, requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Most cart operations work for both authenticated and guest users
// optionalAuth: populates req.user if token present, else proceeds as guest

// Get cart (guest or authenticated)
router.get('/', optionalAuth, cartController.getCart);

// Add item to cart
router.post('/items', optionalAuth, cartController.addToCart);

// Update cart item quantity
router.patch('/items/:id', optionalAuth, cartController.updateCartItem);

// Remove item from cart
router.delete('/items/:id', optionalAuth, cartController.removeCartItem);

// Clear entire cart
router.delete('/', optionalAuth, cartController.clearCart);

// Merge guest cart into user cart (requires authentication)
router.post('/merge', requireAuth, cartController.mergeCart);

export default router;
