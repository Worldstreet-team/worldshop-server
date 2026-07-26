import { Router } from 'express';
import * as categoryController from '../controllers/category.controller';

const router = Router();

// Static routes first
router.get('/featured', categoryController.getFeaturedCategories);
router.get('/id/:id/attributes', categoryController.getCategoryAttributesHandler);
router.get('/id/:id', categoryController.getCategoryById);

// Full listing
router.get('/', categoryController.getCategories);

export default router;
