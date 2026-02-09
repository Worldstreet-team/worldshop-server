import { Router } from 'express';
import * as categoryController from '../controllers/category.controller';

const router = Router();

// Static routes first
router.get('/featured', categoryController.getFeaturedCategories);
router.get('/id/:id', categoryController.getCategoryById);

// Full listing
router.get('/', categoryController.getCategories);

// Single category by slug (with paginated products) — must be last
router.get('/:slug', categoryController.getCategoryBySlug);

export default router;
