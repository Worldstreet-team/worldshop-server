import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/wallet/quote', requireAuth, paymentController.walletQuote);
router.get('/verify/:ref', requireAuth, paymentController.verify);

router.post('/webhook/mock', paymentController.mockWebhook);
router.post('/webhook/flutterwave', paymentController.flutterwaveWebhook);

export default router;
