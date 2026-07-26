import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/admin.middleware';
import * as productController from '../controllers/product.management.controller';
import * as adminCategoryController from '../controllers/admin.category.controller';
import * as marketplaceReviewController from '../controllers/marketplace.review.controller';
import * as reportController from '../controllers/report.controller';
import * as adminOrderController from '../controllers/admin.order.controller';
import * as adminInventoryController from '../controllers/admin.inventory.controller';
import * as adminVendorController from '../controllers/admin.vendor.controller';
import * as adminUserController from '../controllers/admin.user.controller';
import * as uploadController from '../controllers/upload.controller';
import { uploadProductImages, uploadCategoryImage, uploadDigitalFiles, handleMulterError } from '../middlewares/upload.middleware';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// ─── Dashboard ──────────────────────────────────────────────────
router.get('/dashboard/stats', productController.getDashboardStats);

// ─── Orders Management ─────────────────────────────────────────
router.get('/orders', adminOrderController.getOrders);
router.get('/orders/stats', adminOrderController.getOrderStats);
router.get('/orders/:id', adminOrderController.getOrder);
router.patch('/orders/:id/status', adminOrderController.updateOrderStatus);
router.post('/orders/:id/resend-digital-delivery', adminOrderController.resendDigitalDelivery);

// ─── Inventory Management ───────────────────────────────────────
router.get('/inventory', adminInventoryController.getInventory);
router.get('/inventory/stats', adminInventoryController.getInventoryStats);
router.get('/inventory/low-stock', adminInventoryController.getLowStockAlerts);
router.patch('/inventory/:id/adjust', adminInventoryController.adjustStock);
router.patch('/inventory/:id/threshold', adminInventoryController.updateThreshold);

// ─── Products CRUD ──────────────────────────────────────────────
router.get('/products', productController.adminListProducts);
router.get('/products/:id', productController.adminGetProduct);
router.post('/products', productController.adminCreateProduct);
router.put('/products/:id', productController.adminUpdateProduct);
router.patch('/products/:id/visibility', productController.adminUpdateProductVisibility);
router.patch('/products/:id/approval', productController.adminUpdateProductApproval);
router.delete('/products/:id', productController.adminDeleteProduct);

// ─── Digital Assets ─────────────────────────────────────────────
router.get('/products/:id/digital-assets', uploadController.getDigitalAssets);
router.post('/products/:id/digital-assets', uploadController.attachDigitalAssets);
router.delete('/digital-assets/:assetId', uploadController.deleteDigitalAsset);

// ─── Report Queue ───────────────────────────────────────────────
// The whole of trust and safety: with money off-platform there is nothing to
// refund or arbitrate, so de-listing is the only lever.
// Specific paths first so they are not read as a report id — including the
// pre-existing commission report, which shares the /reports prefix.
router.get('/reports/commission', adminVendorController.getCommissionReport);
router.get('/reports/queue', reportController.queue);
router.get('/reports/stats', reportController.stats);
router.get('/reports', reportController.list);
router.get('/reports/:id', reportController.get);
router.patch('/reports/:id/claim', reportController.claim);
router.post('/reports/:id/dismiss', reportController.dismiss);
router.post('/reports/:id/action', reportController.action);

// ─── Review Moderation ──────────────────────────────────────────
// De-listing is the platform's only enforcement lever now that money moves
// off-platform, and that extends to reviews.
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

// ─── Image Uploads ──────────────────────────────────────────────
router.post('/upload/images', uploadProductImages, handleMulterError, uploadController.uploadImages);
router.delete('/upload/images', uploadController.deleteImages);

// ─── Digital File Uploads ───────────────────────────────────────
router.post('/upload/digital-files', uploadDigitalFiles, handleMulterError, uploadController.uploadDigitalFiles);

// ─── Vendor Management ──────────────────────────────────────────
router.get('/vendors', adminVendorController.listVendors);
router.get('/vendors/:id', adminVendorController.getVendor);
router.patch('/vendors/:id/status', adminVendorController.updateVendorStatus);
router.get('/vendors/:id/products', adminVendorController.getVendorProducts);

router.get('/withdrawals', adminVendorController.listWithdrawalRequests);
router.get('/withdrawals/:id', adminVendorController.getWithdrawalRequest);
router.patch('/withdrawals/:id/status', adminVendorController.updateWithdrawalRequestStatus);

router.get('/users', adminUserController.listUsers);
router.patch('/users/:id/role', adminUserController.updateUserRole);

// ─── Settings ───────────────────────────────────────────────────
router.get('/settings/commission', adminVendorController.getCommissionRate);
router.patch('/settings/commission', adminVendorController.updateCommissionRate);

export default router;
