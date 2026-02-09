import { Router } from 'express';
import * as checkoutController from '../controllers/checkout.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// All checkout routes require authentication
router.post('/validate', requireAuth, checkoutController.validateCart);

export default router;
