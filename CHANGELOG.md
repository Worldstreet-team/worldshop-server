# Changelog

All notable changes to worldshop-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
