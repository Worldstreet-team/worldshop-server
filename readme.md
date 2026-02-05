# WorldStreet eCommerce - Backend API

A comprehensive eCommerce backend API built with Node.js, TypeScript, Express, Prisma, and MongoDB. Features complete product catalog, cart, checkout, orders, payments (Paystack), and image management (Cloudinary).

## Features

- ✅ **TypeScript** - Full type safety
- ✅ **Express.js** - Fast web framework
- ✅ **Prisma ORM** - Type-safe database client with MongoDB support
- ✅ **MongoDB** - NoSQL database with 16 data models
- ✅ **Cloudinary** - Cloud-based image storage and management
- ✅ **Paystack** - Secure payment processing integration
- ✅ **JWT Authentication** - WorldStreet Identity service integration
- ✅ **Functional Programming** - No class components, pure functions
- ✅ **Error Handling** - Centralized error handling with `catchAsync` and `http-errors`
- ✅ **Inventory Management** - Real-time stock tracking with atomic operations
- ✅ **Order State Machine** - Robust order lifecycle management
- ✅ **Health Check** - Server and database monitoring endpoint
- ✅ **ESLint & Prettier** - Code formatting and linting
- ✅ **Hot Reload** - Development server with nodemon
- ✅ **Logging** - Advanced logging with Winston and daily file rotation
- ✅ **Error Monitoring** - Sentry integration for production error tracking
- ✅ **CORS Support** - Cross-Origin Resource Sharing enabled
- ✅ **Rate Limiting** - IP-based request rate limiting
- ✅ **Prisma Studio** - Database GUI for viewing and editing data

## Quick Start

### Environment Setup

1. Copy environment template:

```bash
cp .env.local .env
```

2. Configure your environment variables in `.env`:

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL="mongodb+srv://user:password@cluster.mongodb.net/worldstreet_ecommerce?retryWrites=true&w=majority"

# Authentication
JWT_SECRET=your-jwt-secret-key
IDENTITY_SERVICE_URL=https://identity.worldstreet.com

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Paystack
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx

# Optional
SENTRY_DSN=your_sentry_dsn_here  # For error monitoring
REDIS_URL=redis://localhost:6379  # For caching
APP_URL=http://localhost:3000
```

> **Note:** Use `DATABASE_URL` for Prisma (not `MONGO_URI`)

### Development

```bash
# Install dependencies
npm install

# Generate Prisma Client
npm run generate

# Start development server (with hot reload)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Start production server (builds first, then runs)
npm run prod

# Run linting
npm run lint

# Open Prisma Studio (Database GUI)
npm run studio

# Run database migrations
npm run migrate:dev     # Development migrations
npm run migrate:deploy  # Production migrations
```

## API Endpoints

### Health Check

- `GET /health` - Check server and database status

### Products

- `GET /api/products` - List products with filters (category, price, search, pagination)
- `GET /api/products/:slug` - Get product details
- `GET /api/products/:id/reviews` - Get product reviews
- `POST /api/products/:id/reviews` - Add review (Auth required)

### Categories

- `GET /api/categories` - List all categories
- `GET /api/categories/:slug` - Get category with products
- `GET /api/categories/tree` - Get category hierarchy

### Cart

- `GET /api/cart` - Get user cart (Session/Auth)
- `POST /api/cart/items` - Add item to cart
- `PATCH /api/cart/items/:id` - Update item quantity
- `DELETE /api/cart/items/:id` - Remove item
- `DELETE /api/cart` - Clear cart
- `POST /api/cart/merge` - Merge guest cart to user (Auth)

### Checkout

- `POST /api/checkout/validate` - Validate cart for checkout (Auth)
- `POST /api/checkout` - Create checkout session (Auth)
- `GET /api/shipping/rates` - Get shipping options (Auth)

### Orders

- `POST /api/orders` - Create order after payment (Auth)
- `GET /api/orders` - List user orders (Auth)
- `GET /api/orders/:id` - Get order details (Auth)
- `POST /api/orders/:id/cancel` - Cancel order (Auth)

### Payments

- `POST /api/payments/initialize` - Initialize Paystack payment (Auth)
- `GET /api/payments/verify/:reference` - Verify payment
- `POST /api/payments/webhook` - Paystack webhook handler

### Addresses

- `GET /api/addresses` - List user addresses (Auth)
- `POST /api/addresses` - Add new address (Auth)
- `PUT /api/addresses/:id` - Update address (Auth)
- `DELETE /api/addresses/:id` - Delete address (Auth)
- `PATCH /api/addresses/:id/default` - Set as default (Auth)

### Wishlist

- `GET /api/wishlist` - Get user wishlist (Auth)
- `POST /api/wishlist/items` - Add to wishlist (Auth)
- `DELETE /api/wishlist/items/:productId` - Remove from wishlist (Auth)

### Admin Endpoints (Admin Auth Required)

#### Products

- `GET /api/admin/products` - List all products
- `POST /api/admin/products` - Create product
- `PUT /api/admin/products/:id` - Update product
- `DELETE /api/admin/products/:id` - Delete product
- `POST /api/admin/products/:id/images` - Upload images

#### Inventory

- `GET /api/admin/inventory` - List inventory
- `GET /api/admin/inventory/low-stock` - Low stock alerts
- `PATCH /api/admin/inventory/:id` - Adjust stock

#### Orders

- `GET /api/admin/orders` - List all orders
- `PATCH /api/admin/orders/:id/status` - Update order status
- `POST /api/admin/orders/:id/refund` - Process refund

#### Categories

- `POST /api/admin/categories` - Create category
- `PUT /api/admin/categories/:id` - Update category
- `DELETE /api/admin/categories/:id` - Delete category

### Debug Endpoints (Development Only)

- `GET /debug-sentry` - Test Sentry error tracking

## Project Structure

```
src/
├── controllers/        # Request handlers
│   ├── products.controller.ts
│   ├── categories.controller.ts
│   ├── cart.controller.ts
│   ├── checkout.controller.ts
│   ├── orders.controller.ts
│   ├── payments.controller.ts
│   ├── reviews.controller.ts
│   ├── addresses.controller.ts
│   ├── wishlist.controller.ts
│   └── admin/
├── services/          # Business logic
│   ├── products.service.ts
│   ├── cart.service.ts
│   ├── inventory.service.ts
│   ├── orders.service.ts
│   ├── payments.service.ts
│   └── cloudinary.service.ts
├── routes/            # Route definitions
│   ├── products.routes.ts
│   ├── cart.routes.ts
│   ├── orders.routes.ts
│   └── admin.routes.ts
├── utils/             # Utility functions (catchAsync, health)
├── configs/           # Configuration files
│   ├── prismaConfig.ts # Prisma client configuration
│   ├── envConfig.ts   # Environment variables
│   ├── loggerConfig.ts # Winston logging setup
│   ├── sentryConfig.ts # Sentry error monitoring
│   └── rateLimitConfig.ts # Simple rate limiting configuration
├── middlewares/       # Custom middleware
│   ├── errorHandler.ts     # Global error handling
│   └── catchAll404Errors.ts # 404 error handling
├── app.ts            # Express app setup
└── server.ts         # Server entry point
prisma/
├── schema.prisma     # Prisma schema definitions
└── migrations/       # Database migrations (auto-generated)
generated/
└── prisma/           # Generated Prisma Client (auto-generated)
logs/                 # Log files (auto-generated)
├── combined-*.log    # Combined logs with rotation
└── error-*.log       # Error logs with rotation
```

## Key Patterns

### Error Handling

All controllers use `catchAsync` wrapper and `http-errors` for consistent error handling:

```typescript
import prisma from '../configs/prismaConfig';

export const getProduct = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { slug } = req.params;

    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        images: true,
        inventory: true,
      },
    });

    if (!product) {
      return next(createError(404, 'Product not found'));
    }

    res.status(200).json({
      status: 'success',
      data: product,
    });
  },
);
```

The global error handler provides comprehensive error handling with:

- Prisma-specific error handling
- MongoDB duplicate key error handling
- Validation error handling
- Different responses for development vs production
- Automatic error logging

### Database Models with Prisma

Using Prisma schema for type-safe database models:

```prisma
// prisma/schema.prisma
model Product {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  name        String
  slug        String   @unique
  description String?
  price       Float
  salePrice   Float?
  sku         String?  @unique
  isActive    Boolean  @default(true)

  categoryId  String   @db.ObjectId
  category    Category @relation(fields: [categoryId], references: [id])

  images      ProductImage[]
  reviews     Review[]
  inventory   Inventory?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Generated TypeScript types are automatically available:

```typescript
import prisma from '../configs/prismaConfig';

// Fully type-safe database queries
const products = await prisma.product.findMany({
  where: { isActive: true },
  include: { category: true, images: true },
});

const product = await prisma.product.create({
  data: {
    name,
    slug,
    price,
    categoryId,
    isActive: true,
  },
});
```

### Logging System

Advanced logging with Winston featuring:

- Multiple log levels (error, warn, info)
- Daily rotating files
- Colored console output for development
- Automatic log compression and retention
- Separate error and combined logs

```typescript
import { globalLog, dbLog, authLog } from './configs/loggerConfig';

globalLog.info('Server started successfully');
dbLog.error('Database connection failed');
```

### Error Monitoring

Sentry integration for production error tracking:

- Automatic error capture and reporting
- Environment-specific configuration
- Debug endpoint for testing error tracking

### Rate Limiting

Simple and effective rate limiting:

- **Basic Rate Limiter**: Applied globally to all routes
- **Production**: 100 requests per 15 minutes
- **Development**: 1000 requests per 15 minutes
- Automatic rate limit headers in response
- Clean error messages when limits are exceeded

```typescript
import { rateLimiter } from './configs/rateLimitConfig';

// Apply rate limiting to all routes
app.use(rateLimiter);
```

### Health Monitoring

Simple health check with readable uptime format:

```json
{
  "status": "success",
  "message": "Server is healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": "2h 15m 30s",
  "database": "connected",
  "server": "online"
}
```

## Development

### Dependencies

**Core Dependencies:**

- `express` - Web framework
- `@prisma/client` - Prisma ORM client
- `prisma` - Prisma CLI and migration tools
- `cloudinary` - Cloud image storage and management
- `axios` - HTTP client for external API calls (Paystack)
- `jsonwebtoken` - JWT token handling
- `bcryptjs` - Password hashing
- `cors` - Cross-origin resource sharing
- `dotenv` - Environment variable loading
- `http-errors` - HTTP error utilities
- `winston` & `winston-daily-rotate-file` - Advanced logging
- `@sentry/node` - Error monitoring and tracking
- `morgan` - HTTP request logging
- `cross-env` - Cross-platform environment variables
- `express-rate-limit` - Request rate limiting
- `ioredis` - Redis client for caching (optional)

**Development Dependencies:**

- `typescript` & `ts-node` - TypeScript support
- `nodemon` - Development hot reload
- `eslint` & `prettier` - Code quality and formatting
- `@types/*` - TypeScript type definitions

### Prisma Commands

```bash
# Generate Prisma Client after schema changes
npx prisma generate

# Create a new migration
npx prisma migrate dev --name migration_name

# Apply migrations in production
npx prisma migrate deploy

# Open Prisma Studio (Database GUI)
npx prisma studio

# Reset database (development only)
npx prisma migrate reset

# Validate schema
npx prisma validate

# Format schema file
npx prisma format
```

### Environment Variables

Required environment variables:

```bash
NODE_ENV=development          # Environment (development/production/prod)
PORT=3000                    # Server port
DATABASE_URL="mongodb+srv://..." # MongoDB connection string for Prisma

# Authentication
JWT_SECRET=your-jwt-secret   # JWT signing secret
IDENTITY_SERVICE_URL=https://identity.worldstreet.com

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Paystack
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_PUBLIC_KEY=pk_test_xxx

# Optional
SENTRY_DSN=https://...       # Sentry DSN (optional)
REDIS_URL=redis://localhost:6379  # Redis for caching
APP_URL=http://localhost:3000
```

> **Important:** Prisma uses `DATABASE_URL` to connect to MongoDB. Make sure this is set correctly in your `.env` file.

### Log Files

The application automatically creates and manages log files in the `logs/` directory:

- `combined-YYYY-MM-DD-HH.log` - All application logs
- `error-YYYY-MM-DD-HH.log` - Error logs only
- Automatic compression and 14-day retention
- Maximum file size of 20MB

## Business Logic

### Inventory Management

Atomic inventory operations with transaction support:

```typescript
// Deduct inventory when order is placed
async function deductInventory(items: OrderItem[], orderId: string) {
  return prisma.$transaction(async (tx) => {
    for (const item of items) {
      const inventory = await tx.inventory.findFirst({
        where: { productId: item.productId },
      });

      if (!inventory || inventory.quantity < item.quantity) {
        throw new InsufficientStockError(item.productId);
      }

      await tx.inventory.update({
        where: { id: inventory.id },
        data: { quantity: { decrement: item.quantity } },
      });
    }
  });
}
```

### Order State Machine

Valid order status transitions:

```typescript
const ORDER_TRANSITIONS = {
  CREATED: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};
```

### Payment Processing (Paystack)

```typescript
import axios from 'axios';

async function initializePayment(
  orderId: string,
  amount: number,
  email: string,
) {
  const response = await axios.post(
    'https://api.paystack.co/transaction/initialize',
    {
      email,
      amount: amount * 100, // Convert to kobo
      reference: orderId,
      callback_url: `${process.env.APP_URL}/api/payments/callback`,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    },
  );

  return response.data;
}
```

### Image Upload (Cloudinary)

```typescript
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadProductImage(file: Express.Multer.File) {
  const result = await cloudinary.uploader.upload(file.path, {
    folder: 'worldstreet/products',
    resource_type: 'image',
  });

  return result.secure_url;
}
```

## External Services

- **WorldStreet Identity**: JWT-based authentication and user management
- **Paystack**: Payment processing and transaction verification
- **Cloudinary**: Image storage, transformation, and CDN delivery
- **Redis** (Optional): Caching for improved performance

## Prisma Benefits

- **Type Safety**: Auto-generated TypeScript types for all database models
- **Auto-completion**: Full IDE support with intelligent auto-complete
- **Migration System**: Version-controlled database schema changes
- **Prisma Studio**: Visual database browser and editor
- **MongoDB Support**: Native MongoDB support with type-safe queries (Prisma 6.19)
- **Zero-cost Abstractions**: Minimal performance overhead

Perfect for building scalable eCommerce platforms with type-safe database access, secure payment processing, and cloud image management!

---

## Database Models

The WorldStreet eCommerce platform includes 16 comprehensive data models:

1. **Product** - Product catalog with variants and images
2. **ProductImage** - Multiple images per product
3. **ProductVariant** - Size, color, and other variations
4. **Category** - Hierarchical product categories
5. **Inventory** - Stock tracking with low-stock alerts
6. **InventoryLog** - Audit trail for inventory changes
7. **Cart** - Shopping cart for guest and authenticated users
8. **CartItem** - Individual cart items
9. **Order** - Customer orders with full lifecycle
10. **OrderItem** - Order line items with snapshots
11. **OrderStatusHistory** - Order status change audit trail
12. **Payment** - Payment records linked to Paystack
13. **Refund** - Refund tracking and processing
14. **Review** - Product reviews and ratings
15. **Address** - User shipping and billing addresses
16. **Wishlist** - User wishlists with items

For complete schema details, see [backend-plan.md](../eCommerce%20WS/docs/backend-plan.md).
