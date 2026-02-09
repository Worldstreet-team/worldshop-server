import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// All order routes require authentication

// List user's orders
router.get('/', requireAuth, orderController.getOrders);

// Get order by order number (must be before :id to avoid conflict)
router.get('/number/:orderNumber', requireAuth, orderController.getOrderByNumber);

// Get single order by ID
router.get('/:id', requireAuth, orderController.getOrderById);

// Create order from cart (checkout)
router.post('/', requireAuth, orderController.createOrder);

// Cancel order
router.post('/:id/cancel', requireAuth, orderController.cancelOrder);

export default router;
