# Changelog

All notable changes to worldshop-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.17.0] - 2026-04-10

### Added — Phase 7: Vendor Reviews & Admin Vendor Management

#### Vendor Reviews
- `src/services/vendor.review.service.ts` — `getVendorReviews(vendorId, query)`: returns paginated reviews across all vendor's products with product name enrichment, rating filter, sort options
- `src/controllers/vendor.review.controller.ts` — `GET /api/v1/vendor/reviews` handler
- `vendor.routes.ts` — Added `/reviews` route (read-only, behind requireVendor)

#### Admin Vendor Management
- `src/services/admin.vendor.service.ts` — `listVendors(query)`, `getVendorDetail(id)`, `updateVendorStatus(id, status)`, `getVendorProducts(userId, query)`, `updateCommissionRate(rate)`, `getCommissionRate()`
- `src/controllers/admin.vendor.controller.ts` — Handlers for all admin vendor endpoints
- `src/validators/admin.vendor.validator.ts` — Zod schemas: `adminVendorListSchema`, `adminVendorStatusSchema`, `adminVendorProductsSchema`, `adminCommissionRateSchema`

#### Admin Routes
- `GET /api/v1/admin/vendors` — Paginated vendor list with status, product count, total earnings
- `GET /api/v1/admin/vendors/:id` — Full vendor detail with stats and recent orders
- `PATCH /api/v1/admin/vendors/:id/status` — Set vendor status (ACTIVE/SUSPENDED/BANNED), fully reversible
- `GET /api/v1/admin/vendors/:id/products` — Vendor's products for admin review
- `GET /api/v1/admin/reports/commission` — Per-vendor commission breakdown + platform totals
- `GET /api/v1/admin/settings/commission` — Current commission rate
- `PATCH /api/v1/admin/settings/commission` — Update commission rate (affects future orders only)

#### Tests
- `src/__tests__/phase7/phase7.test.ts` — 18 integration tests covering vendor reviews (paginated, filtered, empty), admin vendor list (search, status filter), admin vendor detail (stats, 404), vendor status management (suspend, ban, reactivate, same-status rejection), admin vendor products, commission report with settlement, commission settings (update, validation, default)

## [0.16.0] - 2026-04-10

### Added — Phase 6: Platform Ledger & Vendor Earnings

#### Schema (already existed)
- `LedgerEntry` model — orderId, vendorId, type (SALE/COMMISSION/WITHDRAWAL), amount, currency, balanceBefore, balanceAfter
- `VendorBalance` model — vendorId (unique), availableBalance, totalEarned, totalCommission
- `PlatformConfig` model — key-value pairs for platform settings

#### Seed
- `prisma/seed.ts` — Seeds `PlatformConfig` with `commissionRate = "0.10"` via upsert

#### Ledger Write Service (CQRS write side)
- `src/services/ledger.write.service.ts` — `settleOrder(orderId)`: reads order.total + vendorId from DB (caller can't pass wrong amounts), creates SALE + COMMISSION entries atomically in a transaction, upserts VendorBalance. Idempotent via `wasAlreadySettled` flag. Reads commission rate from PlatformConfig (not hardcoded). Rejects non-PAID and platform-owned orders.

#### Ledger Read Service (CQRS read side)
- `src/services/ledger.read.service.ts` — `getVendorBalance(vendorId)`, `getVendorLedger(vendorId, query)` with pagination/filtering by type/date/sort, `getVendorAnalytics(input)` with summary + earningsOverTime buckets, `getCommissionReport(input)` with platform totals + per-vendor breakdown sorted by totalSales desc

#### Ledger Types
- `src/types/ledger.types.ts` — Updated to align with plan's Order-Aware Design C: `SettleOrderResult`, `VendorBalanceSummary`, `VendorAnalyticsInput/Result`, `EarningsBucket`, `CommissionReportInput/Result`, `VendorCommissionBreakdown`, `LedgerEntryResponse`

#### Payment Webhook Integration
- `src/services/payment.service.ts` — After marking orders PAID in webhook confirm handler, calls `settleOrder()` for each vendor order (non-blocking, idempotent, with error logging)

#### Vendor Analytics Controller
- `src/controllers/vendor.analytics.controller.ts` — `getSummary`, `getEarnings`, `getBalance` handlers

#### Routes
- `src/routes/vendor.routes.ts` — Added: `GET /analytics/summary`, `GET /analytics/earnings`, `GET /balance` (all behind `requireAuth + requireVendor`)

#### Tests (11 new, 70 total)
- `src/__tests__/ledger/ledger.test.ts` — 11 tests: settleOrder (creates entries + updates balance, idempotent duplicate handling, reads commission rate from config, rejects non-PAID orders, rejects platform-owned orders, accumulates balance across multiple orders), getVendorBalance (zero balance for new vendor), getVendorLedger (paginated entries, filter by type), getVendorAnalytics (summary with earnings), getCommissionReport (multi-vendor platform report)

## [0.15.0] - 2026-04-10

### Added — Phase 5: Vendor Order Fulfillment

#### Vendor Order Service
- `src/services/vendor.order.service.ts` — `getVendorOrders(vendorId, query)` with pagination, status filtering, search by order number; `getVendorOrder(orderId, vendorId)` with 403 ownership check; `updateVendorOrderStatus(orderId, vendorId, input)` with restricted transitions: PAID → PROCESSING → DELIVERED only. Uses `VENDOR_TRANSITIONS` map. Sets `deliveredAt` timestamp on DELIVERED. Creates `OrderStatusHistory` entries.

#### Vendor Order Validator
- `src/validators/vendor.order.validator.ts` — `vendorOrdersQuerySchema` (page, limit, status, search, sortBy), `updateVendorOrderStatusSchema` (status limited to PROCESSING | DELIVERED, optional note)

#### Vendor Order Controller
- `src/controllers/vendor.order.controller.ts` — `getOrders`, `getOrder`, `updateStatus` handlers using `req.user.id` as vendorId

#### Routes
- `src/routes/vendor.routes.ts` — Added: `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status` (all behind `requireAuth + requireVendor`)

#### Tests (12 new, 59 total)
- `src/__tests__/vendor/vendor-orders.test.ts` — 12 tests: vendor order listing (scoped, filtered, paginated), order detail (ownership, 403 for other vendor, 404), status transitions (PAID→PROCESSING, PROCESSING→DELIVERED, rejected invalid transitions, cross-vendor rejection, terminal state rejection, full lifecycle)

## [0.14.0] - 2026-04-10

### Added — Phase 4: Multi-Vendor Cart & Order Splitting + Mock Payment

#### Schema Changes
- `prisma/schema.prisma` — Order model: added `vendorId String?` (indexed), `checkoutSessionId String?` (indexed), `shippingAddress Json?` (now optional). Payment model: added `checkoutSessionId String? @unique`, renamed `reference` → `transactionRef`, removed `paystackId`/`channel`, added `providerData Json?`, changed provider default to `"mock"`, removed orderId/order relation

#### Payment Service (complete rewrite)
- `src/services/payment.service.ts` — 594 lines. Mock payment implementation: `sendReceiptForOrder()`, `handleDigitalDelivery()`, `generateTransactionRef()` (WS-PAY-xxx), `mockPaymentService` implementing `PaymentServiceInterface` with `initializePayment()` (returns mock redirect URL), `verifyPayment()` (returns status + linked orders), `handleWebhook()` (confirm: atomic PAID on payment+orders+receipts; decline: atomic FAILED+stock restore). Provider-agnostic exports.

#### Checkout Session Service (new)
- `src/services/checkout.service.ts` — 489 lines. `calculateShipping()` (₦2,500 flat, free ≥₦50,000), `isDigitalOnlyCart()`, `validateCart()`, `computeSnapshotToken()` (SHA-256 hash of cart state), `groupItemsByVendor()` (batch vendor profile lookup, per-group shipping), `previewCheckoutSession()` → vendor-grouped preview with issues, `confirmCheckoutSession()` → atomic N-order creation with stock decrement, 409 on token mismatch

#### Payment Types (rewrite)
- `src/types/payment.types.ts` — Removed all Paystack types. Added: `PaymentProviderType`, `PaymentAction`, `PaymentResponse`, `InitPaymentParams`, `InitPaymentResult`, `VerifyPaymentResult`, `WebhookResult`, `PaymentServiceInterface`

#### Order Types (updated)
- `src/types/order.types.ts` — `OrderWithItems` gained `vendorId?`, `checkoutSessionId?`, optional `shippingAddress`. Added: `CheckoutIssue`, `VendorGroup`, `CheckoutSessionPreview`, `ConfirmCheckoutSessionInput`, `CheckoutSessionResult`

#### Controllers & Routes
- `src/controllers/checkout.controller.ts` — `previewCheckoutSession`, `confirmCheckoutSession` (409 handling), `initializePayment`
- `src/controllers/payment.controller.ts` — rewritten to 48 lines: `verify` (GET), `webhook` (POST, no auth)
- `src/routes/checkout.routes.ts` — POST /validate, POST /session/preview, POST /session, POST /pay (all require auth)
- `src/routes/payment.routes.ts` — GET /verify/:ref (auth), POST /webhook (no auth)
- `src/validators/payment.validator.ts` — `webhookBodySchema` replaces `initializePaymentSchema`

#### Cart Enrichment
- `src/services/cart.service.ts` — `formatCartResponse()` now includes `vendorId` and `vendor { storeName, storeSlug }` on each cart item product via batch vendor profile lookup
- `src/types/cart.types.ts` — `CartItemWithProduct.product` gained `vendorId?` and `vendor?`

#### Other Changes
- `src/services/order.service.ts` — `formatOrderResponse` now includes `vendorId`, `checkoutSessionId`
- `src/services/admin.order.service.ts` — removed all `payment: true` includes, added `vendorId`/`checkoutSessionId` to response format
- `src/configs/envConfig.ts` — removed PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY

### Removed
- `src/configs/paystackConfig.ts` — deleted (Paystack completely removed)

#### Tests (13 new, 47 total)
- `src/__tests__/checkout/checkout.test.ts` — 13 tests: checkout preview with vendor grouping, stock issue detection, empty cart, confirm with order splitting + stock decrement + cart clearing, 409 on cart change, digital-only without shipping, initialize payment redirect, confirm webhook marks PAID, decline webhook cancels orders, idempotent duplicate webhook, verify payment status, shipping calculation (flat rate + free threshold)

## [0.13.0] - 2026-04-09

### Added — Phase 3: Public Store Pages

#### Store Service
- `src/services/store.service.ts` — `getStoreBySlug(slug, query)` returns vendor store info + paginated products; validates vendor is active; reuses `listProducts` with vendorId filter for consistent sorting/pagination; returns null for non-existent or suspended/banned vendors

#### Store Controller & Routes
- `src/controllers/store.controller.ts` — `getStore` handler parses query, calls store service, signs product images, enriches with vendor info, returns 404 for missing stores
- `src/routes/store.routes.ts` — `GET /api/v1/store/:slug` public store endpoint
- `src/app.ts` — mounted store routes at `/api/v1/store`

#### Vendor Enrichment on Product Queries
- `src/services/product.service.ts` — `enrichWithVendorInfo()` batch-fetches vendor profiles (storeName, storeSlug) for products with vendorId; avoids N+1 queries
- `src/controllers/product.controller.ts` — all public product endpoints now include vendor info: listing, featured, search, single product (slug/id), related products

#### Tests (8 new, 34 total)
- `src/__tests__/store/store.test.ts` — 8 tests covering: active vendor store lookup, non-existent slug, suspended/banned vendor gates, product visibility (only active+approved), pagination, vendor enrichment

## [0.12.0] - 2026-04-08

### Added — Phase 2: Vendor Product Management

#### Vendor Product Service
- `src/services/vendor.product.service.ts` — full CRUD: `vendorCreateProduct` (auto-SKU, unique slug), `vendorListProducts` (paginated), `vendorGetProduct` (ownership check), `vendorUpdateProduct`, `vendorDeleteProduct` (cascade), `vendorToggleProduct`

#### Vendor Product Validator
- `src/validators/vendor.product.validator.ts` — Zod schemas for create/update product with variants; `vendorProductQuerySchema` for list filtering

#### Vendor Product Controller & Routes
- `src/controllers/vendor.product.controller.ts` — 6 handlers: list, get, create, update, delete, toggle
- `src/routes/vendor.routes.ts` — extended with product CRUD routes under `/api/v1/vendor/products`

#### Public Product Listing Vendor Gates
- `src/services/product.service.ts` — all public queries now filter vendor products by `approvalStatus: 'APPROVED'`; platform products (vendorId = null) pass through unfiltered
- `prisma/schema.prisma` — added `vendorId` (nullable, indexed) and `approvalStatus` (default: APPROVED) to Product model

#### Tests (11 new, 26 total)
- `src/__tests__/vendor/products.test.ts` — 11 tests: create digital product, unique slug, variants, list, get by ID, update, toggle, delete, ownership guard, missing product guard

## [0.11.0] - 2026-04-07

### Added — Phase 1: Vendor Identity & Onboarding

#### Prisma Schema
- `prisma/schema.prisma` — added `VendorStatus` enum (ACTIVE, SUSPENDED, BANNED); added vendor fields to `UserProfile`: `isVendor`, `vendorStatus`, `storeName` (unique), `storeSlug` (unique), `storeDescription`, `vendorSince`

#### Vendor Service
- `src/services/vendor.service.ts` — `registerVendor` (slug generation, reserved slug check, duplicate detection), `getVendorProfile`, `updateVendorProfile`

#### Vendor Validator
- `src/validators/vendor.validator.ts` — Zod schemas for registration and profile update

#### Vendor Controller & Routes
- `src/controllers/vendor.controller.ts` — register, getProfile, updateProfile handlers
- `src/routes/vendor.routes.ts` — mounted at `/api/v1/vendor`

#### Auth Middleware Expansion
- `src/middlewares/auth.middleware.ts` — `requireAuth` now selects vendor fields; added `requireVendor` and `requireActiveVendor` middleware

#### Tests (15 new)
- `src/__tests__/vendor/registration.test.ts` — 8 tests: registration, duplicate slug, reserved slugs, already-vendor guard, profile retrieval
- `src/__tests__/vendor/middleware.test.ts` — 7 tests: requireVendor/requireActiveVendor/requireAdmin middleware gates

## [0.10.0] - 2026-02-13

### Changed — Admin Dashboard Stats Pagination

#### Dashboard Stats Service
- `src/services/admin.product.service.ts` — `getDashboardStats()` now accepts `(page, limit)` parameters for recent orders pagination; uses `skip`/`take` for paginated queries; added `prisma.order.count()` for total; returns `recentOrdersPagination` object (`page, limit, total, totalPages, hasPrevPage, hasNextPage`)

#### Dashboard Stats Controller
- `src/controllers/admin.product.controller.ts` — `getDashboardStats` handler now parses `req.query.page` and `req.query.limit` query parameters (clamped: min 1, max 50); passes parsed values to service function

### Endpoints Changed
- `GET /api/v1/admin/dashboard/stats` — now accepts `?page=1&limit=15` query params; response includes `recentOrdersPagination` alongside `recentOrders`

## [0.9.0] - 2026-02-12

### Added — R2 Signed URLs & Digital Products System

#### R2 Signed URL Infrastructure
- `src/utils/signUrl.ts` — utility functions for generating presigned R2 URLs (`signR2Key`, `signProductImages`, `signProductListImages`, `signOrderImages`, `signCartImages`, `signWishlistImages`)
- All image responses now return time-limited signed URLs instead of raw R2 keys
- Signed URLs have configurable expiry (default 7 days for product images)
- Applied across all controllers: products, cart, wishlist, orders, admin products

#### Upload Service Update
- `src/services/upload.service.ts` — `uploadImage` now returns `{ key, signedUrl }` instead of `{ url, key }`
- All upload consumers updated to use new return shape

#### Zod Validation Fix
- `src/validators/admin.product.validator.ts` — `updateProductSchema` images array now accepts relative URLs (R2 keys like `/products/...`) in addition to full `https://` URLs
- Fixed product update failures when images stored as R2 keys

#### Digital Product System — Prisma Models
- `DigitalAsset` model — `id, productId, fileName, r2Key, mimeType, fileSize, sortOrder, createdAt`
- `DownloadRecord` model — `id, assetId, orderId, orderItemId, userId, downloadCount, maxDownloads (default 2), expiresAt (7 days), firstDownloadAt, lastDownloadAt, createdAt`
- Added `type` field to `Product` model (`PHYSICAL` | `DIGITAL`, default `PHYSICAL`)
- Added `digitalAssets DigitalAsset[]` relation to `Product` model
- `@@index` on `[productId]` for DigitalAsset, `[userId]`, `[orderId]`, `[assetId]` for DownloadRecord

#### Digital Asset Service
- `src/services/digitalAsset.service.ts` — `uploadDigitalFiles` (upload to R2 `digital-assets/` prefix), `getProductDigitalAssets`, `attachAssetsToProduct`, `deleteDigitalAsset` (with R2 cleanup)

#### Download Service
- `src/services/download.service.ts` — `createDownloadRecords` (creates records for all digital assets in an order), `getUserDownloads` (paginated, with signed URLs), `getOrderDownloads`, `generateDownloadUrl` (enforces 2-download limit and 7-day expiry, returns presigned URL)

#### Download Controller & Routes
- `src/controllers/download.controller.ts` — `getMyDownloads`, `getOrderDownloads`, `generateDownloadUrl`
- `src/routes/download.routes.ts` — mounted at `/api/v1/downloads` (all routes require auth)
  - `GET /downloads` — list user's downloads
  - `GET /downloads/order/:orderId` — downloads for specific order
  - `POST /downloads/:id/generate` — generate time-limited download URL

#### Digital Delivery on Payment
- `src/services/payment.service.ts` — after successful payment, automatically creates download records for digital products and sends branded delivery email
- `src/services/email.service.ts` — added `sendDigitalDeliveryEmail()` with branded gold HTML template, download links, and usage limit notice (2 downloads, 7-day expiry)

### Endpoints Added
- `GET /api/v1/downloads` — list user's downloads with signed URLs (auth)
- `GET /api/v1/downloads/order/:orderId` — downloads for specific order (auth)
- `POST /api/v1/downloads/:id/generate` — generate download URL (auth, enforces limits)
- `POST /api/v1/admin/products/:id/digital-assets` — upload digital files (admin)
- `GET /api/v1/admin/products/:id/digital-assets` — list digital assets (admin)
- `POST /api/v1/admin/digital-assets/attach` — attach temp assets to product (admin)
- `DELETE /api/v1/admin/digital-assets/:id` — delete digital asset (admin)

### Technical Notes
- R2 keys stored in DB, signed on response — URLs auto-expire, no stale public URLs
- Digital delivery is automatic post-payment — no manual admin intervention needed
- Download limit (2) and expiry (7 days) are configurable per-record
- `@aws-sdk/s3-request-presigner` used for generating presigned GET URLs

## [0.8.0] - 2026-02-12

### Added — Phase 5: Admin Panel Backend

#### Cloudflare R2 Image Upload
- `src/configs/r2Config.ts` — S3Client configured for Cloudflare R2 (S3-compatible)
- `src/services/upload.service.ts` — `uploadImage`, `uploadMultipleImages`, `deleteImage`, `deleteMultipleImages`, `extractKeyFromUrl`
- `src/middlewares/upload.middleware.ts` — multer memory storage, 5MB limit, JPEG/PNG/WebP/GIF/SVG filter, `uploadProductImages` (max 10), `uploadCategoryImage` (single)
- `src/controllers/upload.controller.ts` — `POST /admin/upload/images`, `DELETE /admin/upload/images`

#### Admin Product CRUD
- `src/validators/admin.product.validator.ts` — `createProductSchema`, `updateProductSchema`, `adminProductQuerySchema` (Zod v4)
- `src/services/admin.product.service.ts` — `adminListProducts` (filter by status/stock/search, includes inactive), `createProduct` (unique slug generation, variants), `updateProduct` (slug regen, variant replace), `deleteProduct` (soft delete), `hardDeleteProduct`, `getDashboardStats`
- `src/controllers/admin.product.controller.ts` — full CRUD handlers + dashboard stats endpoint

#### Admin Category CRUD
- `src/validators/admin.category.validator.ts` — `createCategorySchema`, `updateCategorySchema`, `adminCategoryQuerySchema`
- `src/services/admin.category.service.ts` — `adminListCategories`, `createCategory` (unique slug), `updateCategory`, `deleteCategory` (soft delete, unlink children, optionally move products), `getCategoryById`
- `src/controllers/admin.category.controller.ts` — full CRUD handlers

#### Admin Routes
- `src/routes/admin.routes.ts` — all routes behind `requireAuth` + `requireAdmin` middleware
  - `GET /admin/dashboard/stats` — aggregate dashboard statistics
  - `GET|POST /admin/products`, `GET|PUT|DELETE /admin/products/:id`
  - `GET|POST /admin/categories`, `GET|PUT|DELETE /admin/categories/:id`
  - `POST|DELETE /admin/upload/images`
- Mounted at `/api/v1/admin` in `app.ts`

### Technical Notes
- Express 5 `req.params.id` returns `string | string[]` — used `as string` cast throughout
- Zod v4 `z.record()` requires two arguments: `z.record(z.string(), z.string())`
- Prisma `InputJsonValue` incompatible with `Record<string, unknown>[]` — solved via `JSON.parse(JSON.stringify())`

## [0.7.1] - 2026-02-11

### Fixed — Cart Unique Constraint Issues
- MongoDB treats `null` as a unique value for unique constraints
- Changed authenticated user cart creation to use `sessionId: "user_{userId}"` placeholder instead of `null`
- Fixed cart migration to use unique placeholder `migrated_{userId}_{timestamp}` instead of `null`
- Updated `getCartIdentifiers()` in cart controller to ignore sessionId entirely when user is authenticated
- Applied fixes to `getOrCreateCart`, `addToCart`, and `mergeGuestCartToUser` functions
- Resolved "Cart_sessionId_key unique constraint failed" errors for authenticated users

### Changed
- Cart service now uses find-then-create pattern instead of upsert for better control and error handling

## [0.7.0] - 2026-02-10

### Added — Service 9: Reviews (Customer-Facing)
- `Review` Prisma model — `productId @db.ObjectId`, `userId`, `userName`, `rating (1-5)`, `title?`, `comment`, `isVerified`, `@@unique([productId, userId])`, indexes on productId and userId
- `src/types/review.types.ts` — `ReviewResponse`, `ReviewSummary` (with rating distribution), `PaginatedReviews`
- `src/validators/review.validator.ts` — `createReviewSchema`, `updateReviewSchema`, `reviewsQuerySchema` (Zod schemas)
- `src/services/review.service.ts` — `getProductReviews` (paginated, filterable by rating, sortable), `getReviewSummary`, `createReview` (auto-verifies if user has DELIVERED order), `updateReview`, `deleteReview`, `getUserReviewForProduct`
- `src/controllers/review.controller.ts` — `getProductReviews`, `getReviewSummary`, `getMyReview`, `createReview`, `updateReview`, `deleteReview`
- `src/routes/review.routes.ts` — mounted at `/api/v1/products/:productId/reviews` with `mergeParams: true`
- Auto-recalculates `Product.avgRating` and `Product.reviewCount` on every create/update/delete via Prisma aggregate
- One review per user per product enforced via `@@unique([productId, userId])`

### Added — Service 10: Wishlist
- `Wishlist` Prisma model — `userId @unique`, one-to-many `WishlistItem[]`
- `WishlistItem` Prisma model — `wishlistId @db.ObjectId`, `productId @db.ObjectId`, `addedAt`, `@@unique([wishlistId, productId])`
- Added `reviews Review[]` and `wishlistItems WishlistItem[]` relations to `Product` model
- `src/types/wishlist.types.ts` — `WishlistItemResponse` (with product details), `WishlistResponse`
- `src/services/wishlist.service.ts` — `getWishlist` (auto-create on first access), `addToWishlist`, `removeFromWishlist`, `isInWishlist`
- `src/controllers/wishlist.controller.ts` — `getWishlist`, `addToWishlist`, `removeFromWishlist`, `checkWishlist`
- `src/routes/wishlist.routes.ts` — all routes behind `requireAuth`

### Changed
- `app.ts` — mounted review routes at `/api/v1/products/:productId/reviews` and wishlist routes at `/api/v1/wishlist`; added both to endpoint info response

### Endpoints Added
- `GET /api/v1/products/:productId/reviews` — paginated reviews (public)
- `GET /api/v1/products/:productId/reviews/summary` — review summary + distribution (public)
- `GET /api/v1/products/:productId/reviews/mine` — current user's review (auth)
- `POST /api/v1/products/:productId/reviews` — create review (auth)
- `PUT /api/v1/products/:productId/reviews/:reviewId` — update own review (auth)
- `DELETE /api/v1/products/:productId/reviews/:reviewId` — delete own review (auth)
- `GET /api/v1/wishlist` — get wishlist with product details (auth)
- `POST /api/v1/wishlist/items` — add product to wishlist (auth)
- `DELETE /api/v1/wishlist/items/:productId` — remove from wishlist (auth)
- `GET /api/v1/wishlist/check/:productId` — check if in wishlist (auth)

## [0.6.2] - 2026-02-09

### Fixed — Resend Email Integration (Render Deploy)
- `resendConfig.ts` simplified to direct `import { Resend } from 'resend'` (matches reference pattern)
- Added `paths` mapping in `tsconfig.json` (`"resend": ["./node_modules/resend/dist/index.d.cts"]`) to resolve Resend SDK exports with default `node10` moduleResolution
- Removed previous `require()` lazy-loading workaround and typed interface shim
- Email receipt now fires from both `handleWebhook()` (primary) and `verifyPayment()` (fallback) via `sendReceiptIfNeeded()` dedup helper
- Dedup prevents duplicate emails — checks `Payment.metadata.receiptSentAt` before sending
- Build and runtime verified on Render.com

## [0.6.1] - 2026-02-09

### Added — Email Receipts (Resend)
- `resend` dependency for transactional emails
- `src/configs/resendConfig.ts` — Resend client instance with env guard
- `src/services/email.service.ts` — `sendOrderReceipt()` fire-and-forget function with full HTML receipt template
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` environment variables in `envConfig.ts`

### Changed
- `payment.service.ts` — `handleWebhook()` now sends order receipt email after successful `charge.success` webhook
- Receipt includes: order number, date, payment channel, itemised line items with images, subtotal/shipping/discount/total, shipping address, "View My Orders" CTA
- Email failures are logged via Winston — never block or break the checkout flow

## [0.6.0] - 2026-02-09

### Added — Service 8: Payments (Paystack)
- `Payment` Prisma model with `orderId @unique`, `userId`, `amount`, `currency`, `status`, `provider`, `reference @unique`, `paystackId`, `channel`, `metadata`, `paidAt`, timestamps
- `PaymentStatus` enum (PENDING, COMPLETED, FAILED, REFUNDED)
- `src/configs/paystackConfig.ts` — Paystack API helper (`initializeTransaction`, `verifyTransaction`, `verifyWebhookSignature` HMAC SHA-512)
- `src/types/payment.types.ts` — `PaymentResponse`, `InitializePaymentResult`, `VerifyPaymentResult`, `PaystackInitResponse`, `PaystackVerifyResponse`, `PaystackWebhookEvent`
- `src/validators/payment.validator.ts` — `initializePaymentSchema` (orderId)
- `src/services/payment.service.ts` — `initializePayment` (ownership check, CREATED status guard, idempotent re-init for PENDING, creates Payment record, calls Paystack API), `verifyPayment` (verify with Paystack, update Payment + Order status in transaction), `handleWebhook` (idempotent charge.success/charge.failed handling)
- `src/controllers/payment.controller.ts` — `initialize`, `verify`, `webhook` (HMAC signature verification, no auth)
- `src/routes/payment.routes.ts` — POST `/initialize` (requireAuth), GET `/verify/:reference` (requireAuth), POST `/webhook` (no auth)
- Mounted at `/api/v1/payments` in `app.ts`
- `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` in envConfig

### Endpoints Added
- `POST /api/v1/payments/initialize` — initialize Paystack payment for an order (auth required)
- `GET /api/v1/payments/verify/:reference` — verify payment status (auth required)
- `POST /api/v1/payments/webhook` — Paystack webhook handler (HMAC SHA-512 verified, no auth)

### Payment Flow
1. User creates order (status: CREATED) → POST `/orders`
2. Frontend calls POST `/payments/initialize` with orderId
3. Backend creates Payment (PENDING), calls Paystack API, returns authorization URL
4. User redirected to Paystack hosted payment page
5. On success: Paystack redirects to `/checkout/success?reference=xxx`
6. Frontend calls GET `/payments/verify/:reference` → backend verifies with Paystack, updates Payment (COMPLETED) + Order (PAID)
7. Paystack also sends webhook POST → backend processes idempotently

## [0.5.0] - 2026-02-09

### Added — Service 6: Addresses
- `Address` Prisma model with `userId`, `label`, `firstName`, `lastName`, `phone`, `street`, `apartment`, `city`, `state`, `country` (default "Nigeria"), `postalCode`, `isDefault`, timestamps
- `@@index([userId])` for efficient per-user queries
- `src/types/address.types.ts` — `AddressResponse` interface, `ADDRESS_LIMITS` (max 5 per user), `NIGERIAN_STATES` tuple constant (37 states)
- `src/validators/address.validator.ts` — `createAddressSchema`, `updateAddressSchema` with `z.enum(NIGERIAN_STATES)` for state validation
- `src/services/address.service.ts` — `getUserAddresses`, `getAddressById`, `createAddress` (enforces max 5, auto-default for first), `updateAddress`, `deleteAddress` (prevents deleting default), `setDefaultAddress`
- `src/controllers/address.controller.ts` — 6 controller functions wrapped in `catchAsync`
- `src/routes/address.routes.ts` — all routes behind `requireAuth`
- Mounted at `/api/v1/addresses` in `app.ts`

### Endpoints Added
- `GET /api/v1/addresses` — list user addresses (default first, then newest)
- `GET /api/v1/addresses/:id` — get single address (ownership enforced)
- `POST /api/v1/addresses` — create address (max 5 limit)
- `PUT /api/v1/addresses/:id` — update address
- `DELETE /api/v1/addresses/:id` — delete address (cannot delete default)
- `PATCH /api/v1/addresses/:id/default` — set as default address

## [0.4.0] - 2026-02-09

### Added — Service 5: Cart & Orders
- `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderStatusHistory` Prisma models
- `OrderStatus` enum (PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED)
- Cart service with guest (sessionId) and authenticated (userId) support
- Cart merge on login (guest → authenticated)
- Checkout service with cart validation (stock + price verification)
- Order service with order creation from cart, order listing with pagination, order detail, and cancellation
- Shipping calculation (free over ₦50,000, flat ₦2,500 otherwise)
- Order number generation (`WS-YYYYMMDD-XXXXX` format)
- Stock decrement on order creation (transactional)

### Endpoints Added
- `GET /api/v1/cart` — get or create cart
- `POST /api/v1/cart/items` — add item to cart
- `PATCH /api/v1/cart/items/:id` — update cart item quantity
- `DELETE /api/v1/cart/items/:id` — remove cart item
- `DELETE /api/v1/cart` — clear cart
- `POST /api/v1/cart/merge` — merge guest cart into user cart
- `POST /api/v1/checkout/validate` — validate cart for checkout
- `POST /api/v1/orders` — create order from cart
- `GET /api/v1/orders` — list user orders (paginated)
- `GET /api/v1/orders/:id` — get order detail
- `GET /api/v1/orders/number/:orderNumber` — get order by order number
- `POST /api/v1/orders/:id/cancel` — cancel order

## [0.3.0] - 2026-02-09

### Added — Service 3: Products
- Product, ProductImage, and ProductVariant Prisma models
- Product list and detail endpoints with filtering and pagination
- Product validators, service, controller, and routes

### Added — Service 4: Categories
- Category Prisma model
- Category list and detail endpoints
- Category validators, service, controller, and routes

## [0.2.0] - 2026-02-08

### Added — Service 1: Auth Middleware
- JWT authentication middleware (`requireAuth`, `optionalAuth`) with local token verification
- Admin authorization middleware (`requireAdmin`) for role-based access control
- Zod validation middleware (`validate`, `validateQuery`) for request body and query param validation
- Express Request type extension with `JwtPayload` (id, email, firstName, lastName, role)
- Cookie-parser support for reading HttpOnly JWT cookies from WorldStreet Identity
- JWT environment config: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`

### Added — Service 2: Profile
- `UserProfile` Prisma model with userId, email, firstName, lastName, phone, avatar, dateOfBirth, gender
- `Gender` enum (MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY)
- Profile service with auto-create on first access (`getOrCreateProfile`)
- Profile update with Zod validation (`updateProfileSchema`)
- `GET /api/v1/profile` — fetch authenticated user's profile
- `PATCH /api/v1/profile` — update profile fields

### Changed
- CORS now configured for `shop.worldstreetgold.com` + localhost dev origins, with `credentials: true`
- CORS allows `X-Session-ID` header (for future guest cart)
- `envConfig.ts` exports `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `CLIENT_URL`

### Dependencies
- Added: `jsonwebtoken`, `@types/jsonwebtoken`, `zod`, `cookie-parser`, `@types/cookie-parser`

## [0.1.0] - Initial

### Added
- Express 5 server with TypeScript
- Prisma with MongoDB connection
- Rate limiting, Sentry error tracking, Winston logging
- Task CRUD sample routes
- Health check endpoint
