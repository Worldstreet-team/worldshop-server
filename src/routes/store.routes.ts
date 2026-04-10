import { Router } from 'express';
import * as storeController from '../controllers/store.controller';

const router = Router();

// GET /api/v1/store/:slug — public store page
router.get('/:slug', storeController.getStore);

export default router;
