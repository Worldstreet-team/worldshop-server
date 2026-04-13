import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireVendor } from '../middlewares/vendor.middleware';
import { validate } from '../middlewares/validate.middleware';
import { registerVendorSchema, updateVendorSchema } from '../validators/vendor.validator';
import {
  vendorCreateProductSchema,
  vendorUpdateProductSchema,
  toggleProductSchema,
} from '../validators/product.management.validator';
import * as vendorController from '../controllers/vendor.controller';
import * as productController from '../controllers/product.management.controller';
import * as vendorOrderController from '../controllers/vendor.order.controller';
import * as vendorAnalyticsController from '../controllers/vendor.analytics.controller';
import * as vendorReviewController from '../controllers/vendor.review.controller';
import { updateVendorOrderStatusSchema } from '../validators/vendor.order.validator';
import { uploadProductImages, uploadDigitalFiles, handleMulterError } from '../middlewares/upload.middleware';
import * as uploadController from '../controllers/upload.controller';

const router = Router();

// Registration only needs auth (user isn't a vendor yet)
router.post('/register', requireAuth, validate(registerVendorSchema), vendorController.register);

// All other vendor routes require auth + active vendor
router.use(requireAuth, requireVendor);

// ─── Vendor Profile ─────────────────────────────────────────────
router.get('/profile', vendorController.getProfile);
router.patch('/profile', validate(updateVendorSchema), vendorController.updateProfile);

// ─── Vendor Uploads (reuses same upload controller as admin) ────
router.post('/upload/images', uploadProductImages, handleMulterError, uploadController.uploadImages);
router.delete('/upload/images', uploadController.deleteImages);
router.post('/upload/digital-files', uploadDigitalFiles, handleMulterError, uploadController.uploadDigitalFiles);

// ─── Vendor Products ────────────────────────────────────────────
router.get('/products', productController.vendorListProducts);
router.get('/products/:id', productController.vendorGetProduct);
router.post('/products', validate(vendorCreateProductSchema), productController.vendorCreateProduct);
router.put('/products/:id', validate(vendorUpdateProductSchema), productController.vendorUpdateProduct);
router.delete('/products/:id', productController.vendorDeleteProduct);
router.patch('/products/:id/toggle', validate(toggleProductSchema), productController.vendorToggleProduct);

// ─── Vendor Orders ──────────────────────────────────────────────
router.get('/orders', vendorOrderController.getOrders);
router.get('/orders/:id', vendorOrderController.getOrder);
router.patch('/orders/:id/status', validate(updateVendorOrderStatusSchema), vendorOrderController.updateStatus);

// ─── Vendor Reviews (read-only) ────────────────────────────────
router.get('/reviews', vendorReviewController.getReviews);

// ─── Vendor Analytics & Balance ─────────────────────────────────
router.get('/analytics/summary', vendorAnalyticsController.getSummary);
router.get('/analytics/earnings', vendorAnalyticsController.getEarnings);
router.get('/balance', vendorAnalyticsController.getBalance);

export default router;
