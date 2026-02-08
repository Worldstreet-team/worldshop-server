import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { updateProfileSchema } from '../validators/profile.validator';
import * as profileController from '../controllers/profile.controller';

const router = Router();

// All profile routes require authentication
router.use(requireAuth);

// GET  /api/v1/profile       — Get my profile
router.get('/', profileController.getProfile);

// PATCH /api/v1/profile      — Update my profile
router.patch('/', validate(updateProfileSchema), profileController.updateProfile);

export default router;
