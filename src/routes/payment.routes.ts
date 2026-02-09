import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Initialize payment (requires auth)
router.post('/initialize', requireAuth, paymentController.initialize);

// Verify payment after redirect (requires auth)
router.get('/verify/:reference', requireAuth, paymentController.verify);

// Paystack webhook (NO auth — signature-verified)
router.post('/webhook', paymentController.webhook);

export default router;
