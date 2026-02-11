# WorldShop Server - Project Status

**Last Updated:** February 12, 2026  
**Version:** 0.9.0  
**Framework:** Node.js + Express + TypeScript + Prisma + MongoDB

---

## 📋 Table of Contents

1. [Technology Stack](#technology-stack)
2. [Project Architecture](#project-architecture)
3. [Completed Features](#completed-features)
4. [Pending Features](#pending-features)
5. [File Structure](#file-structure)
6. [API Endpoints](#api-endpoints)
7. [Database Models](#database-models)

---

## 🛠️ Technology Stack

### Core Dependencies

- **Express:** 5.2.1 - Web framework
- **TypeScript:** 5.9.3 - Type safety
- **Prisma:** 6.19 - ORM with MongoDB support
- **@prisma/client:** 6.19 - Prisma client
- **MongoDB** - NoSQL database
- **ts-node:** 10.9.2 - TypeScript execution
- **nodemon:** 3.1.11 - Development hot reload

### Middleware & Utilities

- **CORS:** 2.8.6 - Cross-origin resource sharing
- **dotenv:** 17.2.3 - Environment variable management
- **http-errors:** 2.0.1 - HTTP error utilities
- **morgan:** 1.10.1 - HTTP request logger
- **express-rate-limit:** 8.2.1 - Rate limiting
- **cross-env:** 10.1.0 - Cross-platform env variables

### Logging & Monitoring

- **winston:** 3.19.0 - Advanced logging
- **winston-daily-rotate-file:** 5.0.0 - Log rotation
- **@sentry/node:** 10.36.0 - Error monitoring

### Email & Payments

- **resend:** 6.9.1 - Transactional email service
- **Paystack** - Payment gateway (NGN ₦)

### File Storage & CDN

- **@aws-sdk/client-s3** - Cloudflare R2 (S3-compatible) file uploads
- **@aws-sdk/s3-request-presigner** - Presigned URL generation for secure file access
- **multer** - Multipart file upload handling (memory storage)

### Dev Tools

- **ESLint:** 9.39.2 - Code linting
- **Prettier:** 3.8.1 - Code formatting
- **@types/\*** - TypeScript type definitions

---

## 🏗️ Project Architecture

### Functional Programming Patterns

- **No class components** - Pure functions throughout
- **catchAsync wrapper** - Functional error handling
- **Immutable operations** - Data transformation patterns
- **Composable services** - Modular business logic

### Configuration Layer (`/src/configs/`)

- **envConfig.ts** - Environment variable management (incl. JWT secrets, CLIENT_URL, R2 credentials)
- **prismaConfig.ts** - Prisma client singleton with connection pooling
- **loggerConfig.ts** - Winston logger configuration with daily rotation
- **sentryConfig.ts** - Sentry error monitoring setup
- **rateLimitConfig.ts** - Rate limiting configuration
- **paystackConfig.ts** - Paystack API helpers (initialize, verify, webhook HMAC)
- **resendConfig.ts** - Resend email client instance
- **r2Config.ts** - Cloudflare R2 S3Client configuration

### Utility Functions (`/src/utils/`)

- **catchAsync.ts** - Async error wrapper for controllers
- **health.ts** - Health check endpoint with uptime formatting
- **slugify.ts** - URL slug generation
- **pagination.ts** - Pagination helpers
- **signUrl.ts** - R2 presigned URL generation (signR2Key, signProductImages, etc.)

### Middleware (`/src/middlewares/`)

- **errorHandler.ts** - Global error handling with environment-specific responses
- **catchAll404Errors.ts** - 404 error handler
- **rateLimitMiddleware.ts** - Request rate limiting
- **auth.middleware.ts** - JWT authentication (`requireAuth`, `optionalAuth`)
- **admin.middleware.ts** - Admin role authorization (`requireAdmin`)
- **validate.middleware.ts** - Zod request validation (`validate`, `validateQuery`)

### Application Structure

- **app.ts** - Express application setup and middleware configuration
- **server.ts** - HTTP server initialization and listening

---

## ✅ Completed Features

### Phase 1: Project Foundation

- [x] Node.js + TypeScript + Express setup
- [x] Prisma ORM configuration with MongoDB
- [x] Environment variable management
- [x] Hot reload development (nodemon)
- [x] ESLint and Prettier configuration

### Phase 2: Core Infrastructure

- [x] **Database Connection**
  - [x] Prisma client configuration
  - [x] MongoDB connection handling
  - [x] Connection pooling
  - [x] Graceful shutdown

- [x] **Error Handling System**
  - [x] Global error handler middleware
  - [x] `catchAsync` wrapper for async operations
  - [x] `http-errors` integration
  - [x] Prisma error handling
  - [x] MongoDB duplicate key error handling
  - [x] Validation error handling
  - [x] Environment-specific error responses

- [x] **Logging System**
  - [x] Winston logger setup
  - [x] Daily rotating log files
  - [x] Separate error and combined logs
  - [x] Colored console output for development
  - [x] Log compression and 14-day retention
  - [x] Multiple log instances (global, database, auth)

- [x] **Monitoring & Security**
  - [x] Sentry error monitoring integration
  - [x] Health check endpoint with uptime
  - [x] Database connection status check
  - [x] CORS configuration
  - [x] Rate limiting (100 req/15min production, 1000 req/15min dev)
  - [x] Request logging with Morgan

### Phase 3: Sample Implementation

- [x] Task model (Prisma schema)
- [x] Task routes (`/api/v1/tasks`)
- [x] Task controller with CRUD operations
- [x] Example of functional patterns

### Phase 4: Authentication & Authorization (Service 1) ✅

- [x] **JWT Authentication**
  - [x] Integrate with WorldStreet Identity service
  - [x] JWT token verification middleware (`requireAuth`, `optionalAuth`)
  - [x] Cookie-parser for reading HttpOnly JWT cookies
  - [x] Role-based access control (RBAC)

- [x] **User Roles**
  - [x] Customer role
  - [x] Admin role

- [x] **Protected Routes**
  - [x] Auth middleware for protected endpoints
  - [x] Admin middleware for admin endpoints

- [x] **Validation Middleware**
  - [x] Zod validation for request body (`validate`)
  - [x] Zod validation for query params (`validateQuery`)

- [x] **Dependencies Added**
  - [x] jsonwebtoken, @types/jsonwebtoken
  - [x] zod
  - [x] cookie-parser, @types/cookie-parser

### Phase 5: User Profile (Service 2) ✅

- [x] **UserProfile Prisma model**
  - [x] userId, email, firstName, lastName, phone, avatar, dateOfBirth, gender
  - [x] Gender enum (MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY)

- [x] **Profile Service**
  - [x] Auto-create profile on first access (`getOrCreateProfile`)
  - [x] Profile update with Zod validation (`updateProfileSchema`)

- [x] **Profile Endpoints**
  - [x] `GET /api/v1/profile` — fetch authenticated user's profile
  - [x] `PATCH /api/v1/profile` — update profile fields

- [x] **CORS Configuration**
  - [x] `shop.worldstreetgold.com` + localhost dev origins
  - [x] `credentials: true`, `X-Session-ID` header allowed

- [x] **Frontend Integration**
  - [x] Profile page connected to real API
  - [x] Profile auto-creates from auth user data on first visit

### Phase 6: Products & Categories (Services 3-4) ✅

- [x] **Products API**
  - [x] Product listing with filters and pagination
  - [x] Product detail by slug and by id
  - [x] Featured, related, search, price range, and brand endpoints

- [x] **Categories API**
  - [x] Category listing
  - [x] Category detail by slug and by id
  - [x] Featured categories endpoint

### Phase 7: Cart & Checkout (Service 5) ✅

- [x] **Cart Prisma models**
  - [x] `Cart` — userId (nullable for guest), sessionId, expiresAt
  - [x] `CartItem` — cartId, productId, variantId, quantity, price snapshot
  - [x] Relationships: Cart → CartItem → Product/Variant

- [x] **Cart Service**
  - [x] `getOrCreateCart` (guest via sessionId, auth via userId)
  - [x] Add/update/remove cart items with stock validation
  - [x] Clear cart, merge guest cart on login
  - [x] Shipping calculation (free over ₦50,000, flat ₦2,500)

- [x] **Checkout Service**
  - [x] Cart validation (stock availability, price verification)
  - [x] Checkout validation issues list

- [x] **Order Prisma models**
  - [x] `Order` — orderNumber, userId, status enum, subtotal/shipping/discount/total, shippingAddress/billingAddress (JSON), timestamps
  - [x] `OrderItem` — orderId, productId, variantId, quantity, unitPrice, totalPrice, productSnapshot (JSON)
  - [x] `OrderStatusHistory` — orderId, status, changedBy, notes, timestamp
  - [x] `OrderStatus` enum (PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED → CANCELLED → REFUNDED)

- [x] **Order Service**
  - [x] Create order from cart (transactional: validate stock → create order items → decrement stock → clear cart)
  - [x] Order number generation (`WS-YYYYMMDD-XXXXX`)
  - [x] List user orders with pagination
  - [x] Get order by ID or order number (ownership check)
  - [x] Cancel order (only PENDING/CONFIRMED status)

- [x] **Cart Endpoints**
  - [x] `GET /api/v1/cart` — get or create cart
  - [x] `POST /api/v1/cart/items` — add item
  - [x] `PATCH /api/v1/cart/items/:id` — update quantity
  - [x] `DELETE /api/v1/cart/items/:id` — remove item
  - [x] `DELETE /api/v1/cart` — clear cart
  - [x] `POST /api/v1/cart/merge` — merge guest → auth

- [x] **Checkout/Order Endpoints**
  - [x] `POST /api/v1/checkout/validate` — validate cart
  - [x] `POST /api/v1/orders` — create order
  - [x] `GET /api/v1/orders` — list user orders
  - [x] `GET /api/v1/orders/:id` — order detail
  - [x] `GET /api/v1/orders/number/:orderNumber` — order by number
  - [x] `POST /api/v1/orders/:id/cancel` — cancel order

### Phase 8: Addresses (Service 6) ✅

- [x] **Address Prisma model**
  - [x] userId, label, firstName, lastName, phone, street, apartment, city, state, country (default "Nigeria"), postalCode, isDefault
  - [x] `@@index([userId])` for efficient queries

- [x] **Address Service**
  - [x] List addresses (default first, then newest)
  - [x] Get address by ID (ownership enforced)
  - [x] Create address (max 5 per user, auto-default for first)
  - [x] Update address (ownership + default toggle)
  - [x] Delete address (prevents deleting default)
  - [x] Set default address (unsets old, sets new)

- [x] **Address Validation**
  - [x] Nigerian states only via `z.enum(NIGERIAN_STATES)` (37 states + FCT)
  - [x] Required: firstName, lastName, phone, street, city, state
  - [x] Optional: label, apartment, postalCode, isDefault

- [x] **Address Endpoints**
  - [x] `GET /api/v1/addresses` — list user addresses
  - [x] `GET /api/v1/addresses/:id` — get single address
  - [x] `POST /api/v1/addresses` — create address
  - [x] `PUT /api/v1/addresses/:id` — update address
  - [x] `DELETE /api/v1/addresses/:id` — delete address
  - [x] `PATCH /api/v1/addresses/:id/default` — set default

### Phase 9: Payments — Paystack (Service 8) ✅

- [x] **Payment Prisma model**
  - [x] orderId (@unique), userId, amount, currency (NGN), status (PaymentStatus enum), provider ("paystack"), reference (@unique), paystackId, channel, metadata, paidAt
  - [x] `@@index([userId])`

- [x] **Paystack Configuration**
  - [x] `paystackConfig.ts` — `initializeTransaction`, `verifyTransaction`, `verifyWebhookSignature` (HMAC SHA-512)
  - [x] Environment variables: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`

- [x] **Payment Service**
  - [x] `initializePayment` (ownership check, CREATED status guard, idempotent re-init)
  - [x] `verifyPayment` (verify with Paystack, update Payment + Order in transaction)
  - [x] `handleWebhook` (idempotent charge.success/failed handling)

- [x] **Email Integration**
  - [x] Resend service for transactional emails
  - [x] Order receipt emails sent after successful payment
  - [x] Deduplication prevents duplicate receipt emails

### Phase 10: Reviews (Service 9) ✅

- [x] **Review Prisma model**
  - [x] productId, userId, userName, rating (1-5), title, comment, isVerified
  - [x] `@@unique([productId, userId])` — one review per user per product
  - [x] Auto-verifies if user has DELIVERED order

- [x] **Review Service & API**
  - [x] `getProductReviews` (paginated, filterable by rating, sortable)
  - [x] `getReviewSummary` (avg rating + distribution)
  - [x] `createReview`, `updateReview`, `deleteReview`
  - [x] Auto-recalculates `Product.avgRating` and `Product.reviewCount`

- [x] **Review Endpoints**
  - [x] `GET /api/v1/products/:productId/reviews` (public)
  - [x] `GET /api/v1/products/:productId/reviews/summary` (public)
  - [x] `POST /api/v1/products/:productId/reviews` (auth)
  - [x] `PUT /api/v1/products/:productId/reviews/:reviewId` (auth)
  - [x] `DELETE /api/v1/products/:productId/reviews/:reviewId` (auth)

### Phase 11: Wishlist (Service 10) ✅

- [x] **Wishlist Prisma models**
  - [x] `Wishlist` — userId @unique, one-to-many WishlistItem[]
  - [x] `WishlistItem` — wishlistId, productId, addedAt
  - [x] `@@unique([wishlistId, productId])` — prevents duplicates

- [x] **Wishlist Service & API**
  - [x] `getWishlist` (auto-create on first access with product details)
  - [x] `addToWishlist`, `removeFromWishlist`, `isInWishlist`

- [x] **Wishlist Endpoints**
  - [x] `GET /api/v1/wishlist` (auth)
  - [x] `POST /api/v1/wishlist/items` (auth)
  - [x] `DELETE /api/v1/wishlist/items/:productId` (auth)
  - [x] `GET /api/v1/wishlist/check/:productId` (auth)

### Phase 12: Bug Fixes & Optimization ✅

- [x] **Cart MongoDB Unique Constraint Fix**
  - [x] Resolved `sessionId: null` unique constraint conflicts
  - [x] Use `sessionId: "user_{userId}"` for authenticated users
  - [x] Cart migration uses unique timestamps
  - [x] Simplified cart creation logic (find-then-create pattern)

- [x] **Payment Service**
  - [x] `initializePayment` — ownership check, CREATED status guard, idempotent re-init for PENDING, Paystack API call, Payment record creation
  - [x] `verifyPayment` — verify with Paystack, update Payment (COMPLETED) + Order (PAID) in transaction
  - [x] `handleWebhook` — idempotent charge.success/charge.failed processing

- [x] **Payment Endpoints**
  - [x] `POST /api/v1/payments/initialize` — initialize Paystack payment (auth required)
  - [x] `GET /api/v1/payments/verify/:reference` — verify payment (auth required)
  - [x] `POST /api/v1/payments/webhook` — Paystack webhook (HMAC verified, no auth)

### Phase 13: Admin Panel Backend ✅

- [x] **Cloudflare R2 Image Upload**
  - [x] `r2Config.ts` — S3Client configured for Cloudflare R2 (S3-compatible)
  - [x] `upload.service.ts` — `uploadImage`, `uploadMultipleImages`, `deleteImage`, `deleteMultipleImages`
  - [x] `upload.middleware.ts` — multer memory storage, 5MB limit, image filter
  - [x] `upload.controller.ts` — `POST /admin/upload/images`, `DELETE /admin/upload/images`

- [x] **Admin Product CRUD**
  - [x] `admin.product.validator.ts` — create/update/query schemas (Zod v4)
  - [x] `admin.product.service.ts` — list, create (unique slug), update, soft delete, hard delete, dashboard stats
  - [x] `admin.product.controller.ts` — full CRUD handlers + dashboard stats

- [x] **Admin Category CRUD**
  - [x] `admin.category.validator.ts` — create/update/query schemas
  - [x] `admin.category.service.ts` — list, create, update, soft delete
  - [x] `admin.category.controller.ts` — full CRUD handlers

- [x] **Admin Routes**
  - [x] All behind `requireAuth` + `requireAdmin` middleware
  - [x] `GET /admin/dashboard/stats` — aggregate dashboard statistics
  - [x] Product CRUD: `GET|POST /admin/products`, `GET|PUT|DELETE /admin/products/:id`
  - [x] Category CRUD: `GET|POST /admin/categories`, `GET|PUT|DELETE /admin/categories/:id`
  - [x] Upload: `POST|DELETE /admin/upload/images`

### Phase 14: R2 Signed URLs ✅

- [x] **Signed URL Utility**
  - [x] `signUrl.ts` — `signR2Key`, `signProductImages`, `signProductListImages`, `signOrderImages`, `signCartImages`, `signWishlistImages`
  - [x] R2 keys stored in DB, signed on response — URLs auto-expire

- [x] **Applied Across All Controllers**
  - [x] Product controller (list, detail, featured, related, search)
  - [x] Admin product controller (list, detail, create, update)
  - [x] Cart service (cart items with product images)
  - [x] Wishlist service (wishlist items with product images)
  - [x] Order service (order items with product snapshots)

- [x] **Upload Service Update**
  - [x] Returns `{ key, signedUrl }` instead of `{ url, key }`
  - [x] Zod validation updated to accept relative R2 keys

### Phase 15: Digital Products System ✅

- [x] **Digital Asset Model**
  - [x] `DigitalAsset` — id, productId, fileName, r2Key, mimeType, fileSize, sortOrder, createdAt
  - [x] Product `type` field: `PHYSICAL` | `DIGITAL` (default `PHYSICAL`)
  - [x] `digitalAssets` relation on Product model

- [x] **Download Record Model**
  - [x] `DownloadRecord` — id, assetId, orderId, orderItemId, userId, downloadCount, maxDownloads (2), expiresAt (7 days)
  - [x] Tracks first/last download timestamps

- [x] **Digital Asset Service**
  - [x] `uploadDigitalFiles` — upload to R2 `digital-assets/` prefix
  - [x] `getProductDigitalAssets`, `attachAssetsToProduct`, `deleteDigitalAsset`

- [x] **Download Service**
  - [x] `createDownloadRecords` — auto-creates records post-payment
  - [x] `getUserDownloads` — paginated with signed URLs
  - [x] `getOrderDownloads` — downloads for specific order
  - [x] `generateDownloadUrl` — enforces 2-download limit and 7-day expiry

- [x] **Download Endpoints**
  - [x] `GET /api/v1/downloads` — list user's downloads (auth)
  - [x] `GET /api/v1/downloads/order/:orderId` — order downloads (auth)
  - [x] `POST /api/v1/downloads/:id/generate` — generate download URL (auth)

- [x] **Digital Delivery Automation**
  - [x] Auto-creates download records after successful payment
  - [x] Branded gold HTML delivery email via Resend
  - [x] Email includes download links, file list, usage limits

- [x] **Admin Digital Asset Endpoints**
  - [x] `POST /admin/products/:id/digital-assets` — upload digital files
  - [x] `GET /admin/products/:id/digital-assets` — list digital assets
  - [x] `POST /admin/digital-assets/attach` — attach temp assets to product
  - [x] `DELETE /admin/digital-assets/:id` — delete digital asset

---

## 🚧 Pending Features

### Phase 5: Database Schema Migration

- [ ] **Migrate from Mongoose to Prisma**
  - [ ] Convert productModel.ts Mongoose schema to Prisma schema
  - [ ] Create comprehensive Prisma schema with 16+ models
  - [ ] Run Prisma migrations
  - [ ] Generate Prisma client with types

### Phase 6: Core Data Models (Prisma Schema)

#### Product & Catalog Models

- [x] **Product** - Main product model
  - [x] id, name, slug, description, basePrice, salePrice, sku
  - [x] categoryId, brandId, vendorId
  - [x] isActive, isFeatured, isNewArrival
  - [x] ratings, reviewCount
  - [x] timestamps

- [x] **ProductImage** - Product images
  - [x] id, productId, url, altText, sortOrder
  - [x] isDefault, cloudflareId
  - [x] Relationship: Product (one-to-many)

- [x] **ProductVariant** - Size/color/style variants
  - [x] id, productId, sku, name
  - [x] attributes (JSON - size, color, etc.)
  - [x] price, compareAtPrice
  - [x] inventoryId
  - [x] Relationship: Product, Inventory

- [x] **Category** - Product categories
  - [x] id, name, slug, description
  - [x] parentId (self-referential)
  - [x] image, icon
  - [x] sortOrder, isActive
  - [x] Relationship: Products, Parent, Children

- [ ] **Brand** - Product brands
  - [ ] id, name, slug, logo
  - [ ] description, isActive
  - [ ] Relationship: Products

#### Inventory Models

- [ ] **Inventory** - Stock tracking
  - [ ] id, productId, variantId
  - [ ] quantity, reservedQuantity
  - [ ] lowStockThreshold, isInStock
  - [ ] Relationship: Product, Variant, InventoryLogs

- [ ] **InventoryLog** - Inventory audit trail
  - [ ] id, inventoryId, orderId
  - [ ] type (SALE, RETURN, ADJUSTMENT, RESTOCK)
  - [ ] quantityChange, quantityBefore, quantityAfter
  - [ ] reason, performedBy
  - [ ] timestamp

#### Cart Models

- [x] **Cart** - Shopping carts ✅
  - [x] id, userId (nullable for guest carts)
  - [x] sessionId (for guest carts)
  - [x] expiresAt
  - [x] Relationship: CartItems

- [x] **CartItem** - Cart line items ✅
  - [x] id, cartId, productId, variantId
  - [x] quantity, price (snapshot)
  - [x] Relationship: Cart, Product, Variant

#### Order Models

- [x] **Order** - Customer orders ✅
  - [x] id, orderNumber, userId
  - [x] status (PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED)
  - [x] subtotal, shipping, discount, total
  - [x] shippingAddress, billingAddress (JSON)
  - [x] trackingNumber, notes, timestamps

- [x] **OrderItem** - Order line items ✅
  - [x] id, orderId, productId, variantId
  - [x] quantity, unitPrice, totalPrice
  - [x] productSnapshot (JSON - name, image, etc.)
  - [x] Relationship: Order, Product, Variant

- [x] **OrderStatusHistory** - Order status tracking ✅
  - [x] id, orderId, status
  - [x] changedBy, notes
  - [x] timestamp

#### Payment Models

- [x] **Payment** - Payment records ✅
  - [x] id, orderId (@unique), userId
  - [x] provider (default "paystack")
  - [x] status (PENDING, COMPLETED, FAILED, REFUNDED)
  - [x] amount, currency (default "NGN")
  - [x] reference (@unique), paystackId
  - [x] channel (card, bank, ussd, etc.)
  - [x] metadata (JSON)
  - [x] paidAt, timestamps

- [ ] **Refund** - Refund tracking
  - [ ] id, orderId, paymentId
  - [ ] amount, reason, status
  - [ ] processedBy, processedAt
  - [ ] transactionId

#### Review Models

- [x] **Review** - Product reviews ✅
  - [x] id, productId, userId, userName
  - [x] rating (1-5), title, comment
  - [x] isVerified (auto-verified if DELIVERED order exists)
  - [x] @@unique([productId, userId]) — one review per user per product
  - [x] timestamps

- [ ] **ReviewImage** - Review images (deferred to Cloudflare phase)
  - [ ] id, reviewId, url, cloudflareId

#### User-Related Models

- [x] **Address** - User addresses ✅
  - [x] id, userId, label, firstName, lastName, phone
  - [x] street, apartment, city, state, country, postalCode
  - [x] isDefault
  - [x] Nigerian states only, max 5 per user

- [x] **Wishlist** - User wishlists ✅
  - [x] id, userId (@unique)
  - [x] Relationship: WishlistItems

- [x] **WishlistItem** - Wishlist items ✅
  - [x] id, wishlistId, productId
  - [x] addedAt
  - [x] @@unique([wishlistId, productId])
  - [x] Relationship: Wishlist, Product

#### Vendor Models (Future)

- [ ] **Vendor** - Vendor accounts
  - [ ] id, userId, businessName, slug
  - [ ] description, logo, banner
  - [ ] isApproved, isActive
  - [ ] Relationship: Products, User

### Phase 7: Authentication & Authorization ✅ COMPLETED

- [x] **JWT Authentication**
  - [x] Integrate with WorldStreet Identity service
  - [x] JWT token validation middleware
  - [x] Refresh token flow
  - [x] Role-based access control (RBAC)

- [x] **User Roles**
  - [x] Customer role
  - [x] Admin role
  - [ ] Vendor role (future)

- [x] **Protected Routes**
  - [x] Auth middleware for protected endpoints
  - [x] Admin middleware for admin endpoints
  - [ ] Vendor middleware for vendor endpoints

### Phase 8: Product Management API

#### Customer Endpoints

- [x] `GET /api/products` - List products with filters
  - [x] Filter by category, brand, price range
  - [x] Search by name/description
  - [x] Sort by price, name, date, popularity
  - [x] Pagination support
- [x] `GET /api/products/:slug` - Get product details
- [x] `GET /api/products/id/:id` - Get product by id
- [x] `GET /api/products/:id/related` - Get related products
- [x] `GET /api/products/featured` - Get featured products
- [x] `GET /api/products/search` - Search products
- [x] `GET /api/products/price-range` - Get min/max prices
- [x] `GET /api/products/brands` - Get available brands

- [ ] `GET /api/products/:id/variants` - Get product variants
- [x] `GET /api/products/:id/reviews` - Get product reviews ✅
- [x] `POST /api/products/:id/reviews` - Add review (Auth) ✅
- [ ] `GET /api/products/new-arrivals` - Get new products
- [ ] `GET /api/products/best-sellers` - Get popular products

#### Admin Endpoints

- [ ] `GET /api/admin/products` - List all products (paginated)
- [ ] `POST /api/admin/products` - Create product
- [ ] `PUT /api/admin/products/:id` - Update product
- [ ] `DELETE /api/admin/products/:id` - Delete product
- [ ] `POST /api/admin/products/:id/images` - Upload images (Cloudflare)
- [ ] `DELETE /api/admin/products/:id/images/:imageId` - Delete image
- [ ] `POST /api/admin/products/:id/variants` - Add variant
- [ ] `PUT /api/admin/products/:id/variants/:variantId` - Update variant
- [ ] `DELETE /api/admin/products/:id/variants/:variantId` - Delete variant

### Phase 9: Category Management API

- [x] `GET /api/categories` - List all categories
- [x] `GET /api/categories/:slug` - Get category with products
- [x] `GET /api/categories/featured` - Get featured categories
- [x] `GET /api/categories/id/:id` - Get category by id
- [ ] `GET /api/categories/tree` - Get category hierarchy
- [ ] `GET /api/categories/:id/subcategories` - Get subcategories

#### Admin Endpoints

- [ ] `POST /api/admin/categories` - Create category
- [ ] `PUT /api/admin/categories/:id` - Update category
- [ ] `DELETE /api/admin/categories/:id` - Delete category
- [ ] `POST /api/admin/categories/:id/image` - Upload category image

### Phase 10: Cart Management API ✅

- [x] `GET /api/v1/cart` - Get user cart (session/auth)
- [x] `POST /api/v1/cart/items` - Add item to cart
- [x] `PATCH /api/v1/cart/items/:id` - Update item quantity
- [x] `DELETE /api/v1/cart/items/:id` - Remove item from cart
- [x] `DELETE /api/v1/cart` - Clear cart
- [x] `POST /api/v1/cart/merge` - Merge guest cart to user (auth)
- [x] Real-time stock validation

### Phase 11: Checkout & Order API ✅

- [x] `POST /api/v1/checkout/validate` - Validate cart for checkout
  - [x] Check product availability
  - [x] Verify prices
  - [x] Calculate shipping

- [x] `POST /api/v1/orders` - Create order from cart
- [x] `GET /api/v1/orders` - List user orders (auth, paginated)
- [x] `GET /api/v1/orders/:id` - Get order details (auth)
- [x] `GET /api/v1/orders/number/:orderNumber` - Get order by number
- [x] `POST /api/v1/orders/:id/cancel` - Cancel order (auth)

#### Admin Endpoints

- [ ] `GET /api/admin/orders` - List all orders
- [ ] `GET /api/admin/orders/:id` - Get order details
- [ ] `PATCH /api/admin/orders/:id/status` - Update order status
- [ ] `POST /api/admin/orders/:id/refund` - Process refund
- [ ] `GET /api/admin/orders/stats` - Order statistics

### Phase 12: Payment Integration (Paystack) ✅

- [x] `POST /api/v1/payments/initialize` - Initialize Paystack payment
- [x] `GET /api/v1/payments/verify/:reference` - Verify payment
- [x] `POST /api/v1/payments/webhook` - Paystack webhook handler
- [ ] `GET /api/payments/:id` - Get payment details
- [ ] Payment retry logic
- [ ] Failed payment handling
- [ ] Refund processing

### Phase 13: Inventory Management API

- [ ] Real-time stock deduction on order
- [ ] Inventory reservation during checkout
- [ ] Automatic low-stock alerts

#### Admin Endpoints

- [ ] `GET /api/admin/inventory` - List inventory
- [ ] `GET /api/admin/inventory/low-stock` - Low stock alerts
- [ ] `PATCH /api/admin/inventory/:id` - Adjust stock
- [ ] `GET /api/admin/inventory/history` - Inventory logs
- [ ] Bulk inventory import (CSV)

### Phase 14: Review Management API ✅ (Customer-Facing)

- [x] `GET /api/v1/products/:productId/reviews` - Get product reviews (public, paginated, filterable by rating, sortable)
- [x] `GET /api/v1/products/:productId/reviews/summary` - Get review summary with rating distribution (public)
- [x] `GET /api/v1/products/:productId/reviews/mine` - Get current user's review (auth)
- [x] `POST /api/v1/products/:productId/reviews` - Submit review (auth, auto-verify if purchased)
- [x] `PUT /api/v1/products/:productId/reviews/:reviewId` - Update own review (auth)
- [x] `DELETE /api/v1/products/:productId/reviews/:reviewId` - Delete own review (auth)
- [x] Auto-recalculates `Product.avgRating` and `Product.reviewCount` on create/update/delete
- [ ] `POST /api/reviews/:id/helpful` - Mark review helpful (future)
- [ ] `POST /api/reviews/:id/report` - Report review (future)

#### Admin Endpoints

- [ ] `GET /api/admin/reviews` - List all reviews
- [ ] `PATCH /api/admin/reviews/:id/approve` - Approve review
- [ ] `PATCH /api/admin/reviews/:id/reject` - Reject review

### Phase 15: Address Management API ✅

- [x] `GET /api/v1/addresses` - List user addresses (auth)
- [x] `POST /api/v1/addresses` - Add address (auth, max 5)
- [x] `PUT /api/v1/addresses/:id` - Update address (auth)
- [x] `DELETE /api/v1/addresses/:id` - Delete address (auth, cannot delete default)
- [x] `PATCH /api/v1/addresses/:id/default` - Set default address (auth)

### Phase 16: Wishlist API ✅

- [x] `GET /api/v1/wishlist` - Get user wishlist with product details (auth)
- [x] `POST /api/v1/wishlist/items` - Add to wishlist (auth)
- [x] `DELETE /api/v1/wishlist/items/:productId` - Remove from wishlist (auth)
- [x] `GET /api/v1/wishlist/check/:productId` - Check if product is in wishlist (auth)
- [ ] `POST /api/wishlist/items/:id/move-to-cart` - Move to cart (future)

### Phase 17: Brand Management API

- [ ] `GET /api/brands` - List all brands
- [ ] `GET /api/brands/:slug` - Get brand with products

#### Admin Endpoints

- [ ] `POST /api/admin/brands` - Create brand
- [ ] `PUT /api/admin/brands/:id` - Update brand
- [ ] `DELETE /api/admin/brands/:id` - Delete brand

### Phase 18: Search & Filters

- [ ] Full-text search implementation (MongoDB Atlas Search)
- [ ] Advanced filter combinations
- [ ] Search suggestions/autocomplete
- [ ] Search analytics

### Phase 19: Image Management (Cloudflare) ✅ (Partial)

- [x] Image upload service (Cloudflare R2)
- [ ] Image transformation (resize, crop, optimize)
- [x] Image deletion
- [x] Multiple image upload
- [x] R2 signed URL delivery (presigned, auto-expiring)
- [ ] Image CDN delivery (Cloudflare Images integration)

### Phase 20: Email Notifications (Partial) ✅

- [x] Order confirmation / receipt emails (Resend SDK)
- [x] HTML receipt template (itemised, branded, responsive)
- [x] Dedup via `Payment.metadata.receiptSentAt` — no duplicate emails
- [x] Fire-and-forget — email failures never block checkout flow
- [ ] Shipping update emails
- [ ] Password reset emails
- [ ] Welcome emails
- [ ] Low stock alerts (admin)
- [ ] Email templates (generic base)

### Phase 21: Discount & Coupon System

- [ ] Coupon model (code, discount, expiry)
- [ ] Apply coupon to cart
- [ ] Validate coupon eligibility
- [ ] Usage tracking
- [ ] Admin coupon management

### Phase 22: Analytics & Reporting

- [ ] Sales analytics
- [ ] Product performance metrics
- [ ] Customer behavior tracking
- [ ] Revenue reports
- [ ] Inventory reports

### Phase 23: Vendor Management (Multi-vendor)

- [ ] Vendor registration and approval
- [ ] Vendor dashboard
- [ ] Vendor product management
- [ ] Vendor order management
- [ ] Commission tracking
- [ ] Payout system

### Phase 24: Advanced Features

- [ ] Product comparison
- [ ] Recently viewed products
- [ ] Related products algorithm
- [ ] Product recommendations
- [ ] Gift cards
- [ ] Loyalty points system
- [ ] Multi-currency support
- [ ] Multi-language support

### Phase 25: Performance Optimization

- [ ] Redis caching layer
  - [ ] Product catalog caching
  - [ ] Category caching
  - [ ] User session caching
- [ ] Database indexing optimization
- [ ] Query optimization
- [ ] API response compression
- [ ] CDN integration

### Phase 26: Testing

- [ ] Unit tests (Jest)
- [ ] Integration tests
- [ ] API endpoint tests
- [ ] Database tests
- [ ] Load testing
- [ ] Security testing

### Phase 27: DevOps & Deployment

- [ ] Docker containerization
- [ ] Docker Compose for local development
- [ ] CI/CD pipeline setup
- [ ] Staging environment
- [ ] Production deployment
- [ ] Environment variable management
- [ ] Database backup strategy
- [ ] Log aggregation (ELK stack)
- [ ] Performance monitoring (New Relic/DataDog)

---

## 📁 File Structure

```
worldshop-server/
├── prisma/
│   ├── schema.prisma           # Database schema (Prisma)
│   └── migrations/             # Database migrations (auto-generated)
├── generated/
│   └── prisma/                 # Generated Prisma Client (auto-generated)
├── logs/                       # Log files (auto-generated)
│   ├── combined-*.log         # All logs with rotation
│   └── error-*.log            # Error logs only
├── src/
│   ├── configs/               # Configuration files
│   │   ├── envConfig.ts       # Environment variables
│   │   ├── prismaConfig.ts    # Prisma client configuration
│   │   ├── loggerConfig.ts    # Winston logging setup
│   │   ├── sentryConfig.ts    # Sentry error monitoring
│   │   └── rateLimitConfig.ts # Rate limiting config
│   ├── controllers/           # Request handlers
│   │   ├── taskController.ts  # ✅ Sample task controller
│   │   ├── profile.controller.ts       # ✅ Profile endpoints
│   │   ├── products.controller.ts      # ⏳ Product endpoints
│   │   ├── categories.controller.ts    # ⏳ Category endpoints
│   │   ├── cart.controller.ts          # ⏳ Cart operations
│   │   ├── checkout.controller.ts      # ⏳ Checkout flow
│   │   ├── orders.controller.ts        # ⏳ Order management
│   │   ├── payments.controller.ts      # ⏳ Payment processing
│   │   ├── reviews.controller.ts       # ⏳ Review system
│   │   ├── addresses.controller.ts     # ⏳ Address management
│   │   ├── wishlist.controller.ts      # ⏳ Wishlist operations
│   │   └── admin/                      # ⏳ Admin controllers
│   ├── services/              # Business logic
│   │   ├── profile.service.ts          # ✅ Profile operations
│   │   ├── products.service.ts         # ⏳ Product business logic
│   │   ├── cart.service.ts             # ⏳ Cart operations
│   │   ├── inventory.service.ts        # ⏳ Inventory management
│   │   ├── orders.service.ts           # ⏳ Order processing
│   │   ├── payments.service.ts         # ⏳ Payment integration
│   │   └── cloudflare.service.ts       # ⏳ Image upload (Cloudflare)
│   ├── routes/                # Route definitions
│   │   ├── taskRoutes.ts      # ✅ Sample task routes
│   │   ├── profile.routes.ts           # ✅ Profile routes
│   │   ├── products.routes.ts          # ⏳ Product routes
│   │   ├── categories.routes.ts        # ⏳ Category routes
│   │   ├── cart.routes.ts              # ⏳ Cart routes
│   │   ├── orders.routes.ts            # ⏳ Order routes
│   │   └── admin.routes.ts             # ⏳ Admin routes
│   ├── middlewares/           # Custom middleware
│   │   ├── errorHandler.ts    # ✅ Global error handler
│   │   ├── catchAll404Errors.ts # ✅ 404 handler
│   │   ├── rateLimitMiddleware.ts # ✅ Rate limiting
│   │   ├── auth.middleware.ts          # ✅ JWT auth (requireAuth, optionalAuth)
│   │   ├── admin.middleware.ts         # ✅ Admin guard (requireAdmin)
│   │   └── validate.middleware.ts      # ✅ Zod validation (validate, validateQuery)
│   ├── models/                # Data models
│   │   ├── Task.ts            # ✅ Sample task model
│   │   └── productModel.ts    # 🔄 Mongoose (needs Prisma migration)
│   ├── utils/                 # Utility functions
│   │   ├── catchAsync.ts      # ✅ Async wrapper
│   │   └── health.ts          # ✅ Health check
│   ├── app.ts                 # ✅ Express app setup
│   └── server.ts              # ✅ Server entry point
├── .env                       # Environment variables (not in git)
├── .env.local                 # Environment template
├── .gitignore                 # Git ignore rules
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── readme.md                  # ✅ Project documentation
├── Starter-template.md        # Template documentation
└── PROJECT-STATUS.md          # This file

Legend:
✅ Completed
🔄 In Progress / Needs Migration
⏳ To Be Built
```

---

## 🔌 API Endpoints

### Current Endpoints (✅ Implemented)

| Method   | Endpoint            | Description          | Auth     |
| -------- | ------------------- | -------------------- | -------- |
| `GET`    | `/`                 | API status           | Public   |
| `GET`    | `/health`           | Health check         | Public   |
| `GET`    | `/api/v1/tasks`     | List tasks           | Public   |
| `POST`   | `/api/v1/tasks`     | Create task          | Public   |
| `GET`    | `/api/v1/tasks/:id` | Get task             | Public   |
| `PUT`    | `/api/v1/tasks/:id` | Update task          | Public   |
| `DELETE` | `/api/v1/tasks/:id` | Delete task          | Public   |
| `GET`    | `/api/v1/profile`   | Get user profile     | Auth     |
| `PATCH`  | `/api/v1/profile`   | Update user profile  | Auth     |
| `GET`    | `/debug-sentry`     | Test Sentry          | Dev Only |

#### Products — Reviews (Service 9) ✅

| Method   | Endpoint                                        | Description                 | Auth     |
| -------- | ----------------------------------------------- | --------------------------- | -------- |
| `GET`    | `/api/v1/products/:productId/reviews`           | List reviews (paginated)    | Public   |
| `GET`    | `/api/v1/products/:productId/reviews/summary`   | Review summary + distribution | Public |
| `GET`    | `/api/v1/products/:productId/reviews/mine`      | Get own review              | Auth     |
| `POST`   | `/api/v1/products/:productId/reviews`           | Create review               | Auth     |
| `PUT`    | `/api/v1/products/:productId/reviews/:reviewId` | Update own review           | Auth     |
| `DELETE` | `/api/v1/products/:productId/reviews/:reviewId` | Delete own review           | Auth     |

#### Wishlist (Service 10) ✅

| Method   | Endpoint                                | Description                  | Auth |
| -------- | --------------------------------------- | ---------------------------- | ---- |
| `GET`    | `/api/v1/wishlist`                      | Get user wishlist            | Auth |
| `POST`   | `/api/v1/wishlist/items`                | Add product to wishlist      | Auth |
| `DELETE` | `/api/v1/wishlist/items/:productId`     | Remove from wishlist         | Auth |
| `GET`    | `/api/v1/wishlist/check/:productId`     | Check if in wishlist         | Auth |

### Planned Endpoints (⏳ To Be Built)

#### Products

- `GET /api/products` - List products (filters, pagination, search)
- `GET /api/products/:slug` - Get product details
- `GET /api/products/featured` - Featured products
- `GET /api/products/new-arrivals` - New products
- `GET /api/products/:id/reviews` - Product reviews
- `POST /api/products/:id/reviews` - Add review (Auth)

#### Categories

- `GET /api/categories` - List categories
- `GET /api/categories/:slug` - Category details with products
- `GET /api/categories/tree` - Category hierarchy

#### Cart

- `GET /api/cart` - Get cart (Session/Auth)
- `POST /api/cart/items` - Add to cart
- `PATCH /api/cart/items/:id` - Update quantity
- `DELETE /api/cart/items/:id` - Remove item
- `DELETE /api/cart` - Clear cart
- `POST /api/cart/merge` - Merge guest cart (Auth)

#### Checkout & Orders

- `POST /api/checkout/validate` - Validate cart (Auth)
- `POST /api/checkout` - Create checkout (Auth)
- `GET /api/shipping/rates` - Shipping options (Auth)
- `POST /api/orders` - Create order (Auth)
- `GET /api/orders` - List orders (Auth)
- `GET /api/orders/:id` - Order details (Auth)
- `POST /api/orders/:id/cancel` - Cancel order (Auth)

#### Payments (Paystack)

- `POST /api/payments/initialize` - Initialize payment (Auth)
- `GET /api/payments/verify/:reference` - Verify payment
- `POST /api/payments/webhook` - Paystack webhook

#### Addresses

- `GET /api/addresses` - List addresses (Auth)
- `POST /api/addresses` - Add address (Auth)
- `PUT /api/addresses/:id` - Update address (Auth)
- `DELETE /api/addresses/:id` - Delete address (Auth)
- `PATCH /api/addresses/:id/default` - Set default (Auth)

#### Wishlist

- `GET /api/wishlist` - Get wishlist (Auth)
- `POST /api/wishlist/items` - Add to wishlist (Auth)
- `DELETE /api/wishlist/items/:productId` - Remove (Auth)

#### Admin (Auth + Admin Role Required)

- `GET /api/admin/products` - List all products
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product
- `POST /api/admin/products/:id/images` - Upload images
- `GET /api/admin/orders` - List all orders
- `PATCH /api/admin/orders/:id/status` - Update order status
- `POST /api/admin/orders/:id/refund` - Process refund
- `GET /api/admin/inventory` - Inventory list
- `GET /api/admin/inventory/low-stock` - Low stock alerts
- `PATCH /api/admin/inventory/:id` - Adjust stock
- `POST /api/admin/categories` - Create category
- `PUT /api/admin/categories/:id` - Update category
- `DELETE /api/admin/categories/:id` - Delete category

---

## 💾 Database Models

### Current Models (✅ Implemented with Prisma)

1. **Task** - Sample CRUD model
   - id, title, description, completed, createdAt, updatedAt

2. **UserProfile** - User profile data (Service 2)
   - id, userId, email, firstName, lastName, phone, avatar, dateOfBirth, gender
   - Gender enum (MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY)

### Legacy Models (🔄 Needs Prisma Migration)

2. **Product** (Mongoose - needs conversion to Prisma)
   - Variant support
   - Image arrays
   - Category relationships
   - Stock tracking

### Planned Models (⏳ To Be Implemented in Prisma)

The following 16+ models need to be added to `prisma/schema.prisma`:

3. **Product** - Main product catalog
4. **ProductImage** - Product images with Cloudflare IDs
5. **ProductVariant** - Size, color, style variants
6. **Category** - Hierarchical categories with parent/children
7. **Brand** - Product brands
8. **Inventory** - Stock tracking with reservations
9. **InventoryLog** - Audit trail for stock changes
10. **Cart** - Shopping carts (guest and authenticated)
11. **CartItem** - Cart line items
12. **Order** - Customer orders with full lifecycle
13. **OrderItem** - Order line items with product snapshots
14. **OrderStatusHistory** - Order status change audit trail
15. **Payment** - Payment records (Paystack integration)
16. **Refund** - Refund tracking and processing
17. **Review** - Product reviews ✅
18. **ReviewImage** - Review images (deferred)
19. **Address** - User shipping and billing addresses ✅
20. **Wishlist** - User wishlists ✅
21. **WishlistItem** - Wishlist items ✅
22. **Vendor** (Future) - Multi-vendor support
23. **Coupon** (Future) - Discount codes
24. **ShippingRate** (Future) - Shipping calculation

---

## 🎯 Next Steps

### Immediate Priorities

1. **Admin Order Management** — Status updates, order processing workflow
2. **Admin Inventory Management** — Stock adjustments, low-stock alerts, inventory logs
3. **Admin Dashboard Enhancement** — Revenue charts, order trends, top products

### Short Term

- Order tracking and shipping integration
- Advanced search with MongoDB Atlas Search
- Profile picture upload (Cloudflare R2)
- Review moderation (admin)

### Medium Term

- Redis caching layer (product catalog, categories)
- Discount & coupon system
- Email notifications (shipping updates, welcome emails)
- Analytics and reporting

### Long Term

- Multi-vendor support
- Testing suite (Jest + integration tests)
- Production deployment & CI/CD
- Performance optimization

---

## 📝 Environment Variables Required

```bash
# Server
NODE_ENV=development              # Environment (development/production/prod)
PORT=3000                        # Server port

# Database
DATABASE_URL="mongodb+srv://..."  # MongoDB connection string (Prisma)

# Authentication (WorldStreet Identity)
JWT_SECRET=your-jwt-secret
IDENTITY_SERVICE_URL=https://identity.worldstreet.com

# Cloudflare (Media Storage)
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-key
CLOUDFLARE_R2_BUCKET_NAME=your-bucket-name
CLOUDFLARE_R2_PUBLIC_URL=https://your-bucket.r2.dev

# Paystack (Payment Gateway)
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_PUBLIC_KEY=pk_test_xxx

# Optional
SENTRY_DSN=https://...           # Sentry error monitoring (optional)
REDIS_URL=redis://localhost:6379 # Redis caching (optional)
APP_URL=http://localhost:3000    # Application URL
FRONTEND_URL=http://localhost:5173 # Frontend URL for redirects
```

---

## 🚀 Available Scripts

```bash
# Development
npm run dev               # Start dev server with hot reload

# Build & Production
npm run build             # Compile TypeScript + Prisma generate + Sentry sourcemaps
npm start                 # Start production server
npm run prod              # Build and start production

# Prisma Commands
npm run generate          # Generate Prisma Client
npm run migrate:dev       # Create and apply migration (development)
npm run migrate:deploy    # Apply migrations (production)
npm run studio            # Open Prisma Studio (database GUI)

# Code Quality
npm run lint              # Run ESLint
```

---

## 🔗 External Services Integration

### Required Services

1. **MongoDB Atlas** - Database hosting
2. **WorldStreet Identity** - User authentication and management
3. **Paystack** - Payment processing (Nigerian market)
4. **Cloudflare** - Image hosting, CDN, and media storage (R2 / Images)

### Optional Services

5. **Sentry** - Error monitoring and tracking
6. **Redis** - Caching layer for performance
7. **SendGrid/Mailgun** - Email delivery
8. **MongoDB Atlas Search** - Full-text search

---

## 📊 Current Status Summary

| Category                | Status         | Progress              |
| ----------------------- | -------------- | --------------------- |
| **Infrastructure**      | ✅ Complete    | 100%                  |
| **Database Schema**     | ✅ Complete    | 100% (16+ models)     |
| **Authentication**      | ✅ Complete    | 100%                  |
| **Profile API**         | ✅ Complete    | 100%                  |
| **Product API**         | ✅ Complete    | 100%                  |
| **Categories API**      | ✅ Complete    | 100%                  |
| **Cart API**            | ✅ Complete    | 100%                  |
| **Order API**           | ✅ Complete    | 100%                  |
| **Address API**         | ✅ Complete    | 100%                  |
| **Payment Integration** | ✅ Complete    | 100% (Paystack)       |
| **Email (Resend)**      | ✅ Complete    | 100% (receipts + digital delivery) |
| **Reviews API**         | ✅ Complete    | 100%                  |
| **Wishlist API**        | ✅ Complete    | 100%                  |
| **Admin APIs**          | ✅ Complete    | 100% (products, categories, uploads) |
| **R2 Signed URLs**      | ✅ Complete    | 100%                  |
| **Digital Products**    | ✅ Complete    | 100% (upload, download, delivery) |
| **Admin Orders**        | ⏳ Not Started | 0%                    |
| **Admin Inventory**     | ⏳ Not Started | 0%                    |
| **Testing**             | ⏳ Not Started | 0%                    |
| **Deployment**          | 🔄 Partial    | Render.com (staging)  |

**Overall Project Completion:** ~75%

---

## 🤝 Contributing Guidelines

When adding features:

1. Follow functional programming patterns (no classes)
2. Use `catchAsync` for all async controller functions
3. Use `http-errors` for error responses
4. Add TypeScript types for all functions
5. Update Prisma schema for new models
6. Run `npm run generate` after schema changes
7. Write migration scripts for database changes
8. Add logging for important operations
9. Document API endpoints in this file
10. Update the progress checklist

---

## 📚 Documentation References

- [Prisma Documentation](https://www.prisma.io/docs)
- [Prisma MongoDB Guide](https://www.prisma.io/docs/concepts/database-connectors/mongodb)
- [Express.js Documentation](https://expressjs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Paystack API Docs](https://paystack.com/docs/api/)
- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [Cloudflare Images Docs](https://developers.cloudflare.com/images/)
- [Winston Logging](https://github.com/winstonjs/winston)
- [Sentry Node.js](https://docs.sentry.io/platforms/node/)

---

**Status:** � Active Development  
**Build Status:** ✅ Passing  
**Database:** 🟢 Connected  
**Last Updated:** February 12, 2026
