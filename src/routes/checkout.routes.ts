import { Router } from 'express';
import * as checkoutController from '../controllers/checkout.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// All checkout routes require authentication
router.post('/validate', requireAuth, checkoutController.validateCart);
router.post('/session/preview', requireAuth, checkoutController.previewCheckoutSession);
router.post('/session', requireAuth, checkoutController.confirmCheckoutSession);
router.post('/pay', requireAuth, checkoutController.initializePayment);

export default router;
