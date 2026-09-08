import { Router } from 'express';
import { requireAdminSession } from '../middlewares/adminSession.middleware';
import * as adminCategoryController from '../controllers/admin.category.controller';
import * as marketplaceReviewController from '../controllers/marketplace.review.controller';
import * as reportController from '../controllers/report.controller';
import * as adminUserController from '../controllers/admin.user.controller';
import * as uploadController from '../controllers/upload.controller';
import { uploadProductImages, handleMulterError } from '../middlewares/upload.middleware';

/**
 * Admin surface for the marketplace. Orders, inventory, product CRUD, vendor
 * management, withdrawals and commission settings were ecommerce features and
 * are gone — with money off-platform, the admin's levers are the taxonomy, the
 * report queue, review moderation and user roles.
 */
const router = Router();

// The console has its own credential auth — an admin password and a session
// cookie, not a Clerk token. See middlewares/adminSession.middleware.ts.
router.use(requireAdminSession);

// ─── Report Queue ───────────────────────────────────────────────
// The whole of trust and safety: de-listing is the only enforcement lever.
// Specific paths first so they are not read as a report id.
router.get('/reports/queue', reportController.queue);
router.get('/reports/stats', reportController.stats);
router.get('/reports', reportController.list);
router.get('/reports/:id', reportController.get);
router.patch('/reports/:id/claim', reportController.claim);
router.post('/reports/:id/dismiss', reportController.dismiss);
router.post('/reports/:id/action', reportController.action);

// ─── Review Moderation ──────────────────────────────────────────
router.patch('/reviews/:id/status', marketplaceReviewController.setStatus);

// ─── Categories CRUD ────────────────────────────────────────────
router.get('/categories', adminCategoryController.getCategories);
// Declared before /categories/:id so it is not swallowed by the id param.
router.get('/categories/tree', adminCategoryController.getTree);
router.get('/categories/:id', adminCategoryController.getCategory);
router.post('/categories', adminCategoryController.createCategory);
router.put('/categories/:id', adminCategoryController.updateCategory);
router.delete('/categories/:id', adminCategoryController.deleteCategory);

// Category attributes — the structured, filterable layer. Leaf categories only.
router.get('/categories/:id/attributes', adminCategoryController.getAttributes);
router.post('/categories/:id/attributes', adminCategoryController.createAttribute);
router.put('/categories/:id/attributes/order', adminCategoryController.reorderAttributes);
router.patch('/categories/:id/attributes/:attributeId', adminCategoryController.updateAttribute);
router.delete('/categories/:id/attributes/:attributeId', adminCategoryController.deleteAttribute);

// ─── Image Uploads (category images etc.) ───────────────────────
router.post('/upload/images', uploadProductImages, handleMulterError, uploadController.uploadImages);
router.delete('/upload/images', uploadController.deleteImages);

// ─── Users ──────────────────────────────────────────────────────
router.get('/users', adminUserController.listUsers);
router.patch('/users/:id/role', adminUserController.updateUserRole);
// For an admin whose setup link was lost or has expired; without it the only
// remedy is demote-then-promote.
router.post('/users/:id/resend-setup', adminUserController.resendSetup);

export default router;
