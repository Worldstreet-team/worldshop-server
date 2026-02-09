# Changelog

All notable changes to worldshop-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
