import { Router } from 'express';
import * as productController from '../controllers/product.controller';

const router = Router();

// Static routes first (before :slug param)
router.get('/featured', productController.getFeatured);
router.get('/search', productController.searchProducts);
router.get('/price-range', productController.getPriceRange);
router.get('/brands', productController.getBrands);
router.get('/id/:id', productController.getProductById);
router.get('/:id/related', productController.getRelatedProducts);

// Paginated listing
router.get('/', productController.getProducts);

// Single product by slug (must be last — catches all unmatched params)
router.get('/:slug', productController.getProductBySlug);

export default router;
