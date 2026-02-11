import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import * as downloadController from '../controllers/download.controller';

const router = Router();

// All download routes require authentication
router.use(requireAuth);

// Get all my downloads
router.get('/', downloadController.getMyDownloads);

// Get downloads for a specific order
router.get('/order/:orderId', downloadController.getOrderDownloads);

// Generate a signed download URL (increments download count)
router.post('/:id/generate', downloadController.generateDownloadUrl);

export default router;
