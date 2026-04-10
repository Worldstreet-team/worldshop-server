import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Verify payment after redirect (requires auth)
router.get('/verify/:ref', requireAuth, paymentController.verify);

// Mock payment webhook (no auth — called by mock payment page)
router.post('/webhook', paymentController.webhook);

export default router;
