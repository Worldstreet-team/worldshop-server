import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { createReportSchema } from '../validators/report.validator';
import * as reportController from '../controllers/report.controller';

const router = Router();

router.use(requireAuth);

// Declared before any :id route.
router.get('/mine', reportController.mine);

router.post('/', validate(createReportSchema), reportController.create);

export default router;
