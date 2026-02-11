import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/admin.middleware';
import * as adminProductController from '../controllers/admin.product.controller';
import * as adminCategoryController from '../controllers/admin.category.controller';
import * as uploadController from '../controllers/upload.controller';
import { uploadProductImages, uploadCategoryImage, uploadDigitalFiles, handleMulterError } from '../middlewares/upload.middleware';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── Dashboard ──────────────────────────────────────────────────
router.get('/dashboard/stats', adminProductController.getDashboardStats);

// ─── Products CRUD ──────────────────────────────────────────────
router.get('/products', adminProductController.getProducts);
router.get('/products/:id', adminProductController.getProduct);
router.post('/products', adminProductController.createProduct);
router.put('/products/:id', adminProductController.updateProduct);
router.delete('/products/:id', adminProductController.deleteProduct);

// ─── Digital Assets ─────────────────────────────────────────────
router.get('/products/:id/digital-assets', uploadController.getDigitalAssets);
router.post('/products/:id/digital-assets', uploadController.attachDigitalAssets);
router.delete('/digital-assets/:assetId', uploadController.deleteDigitalAsset);

// ─── Categories CRUD ────────────────────────────────────────────
router.get('/categories', adminCategoryController.getCategories);
router.get('/categories/:id', adminCategoryController.getCategory);
router.post('/categories', adminCategoryController.createCategory);
router.put('/categories/:id', adminCategoryController.updateCategory);
router.delete('/categories/:id', adminCategoryController.deleteCategory);

// ─── Image Uploads ──────────────────────────────────────────────
router.post('/upload/images', uploadProductImages, handleMulterError, uploadController.uploadImages);
router.delete('/upload/images', uploadController.deleteImages);

// ─── Digital File Uploads ───────────────────────────────────────
router.post('/upload/digital-files', uploadDigitalFiles, handleMulterError, uploadController.uploadDigitalFiles);

export default router;
