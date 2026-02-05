# Important Modules - Node.js API Template

A modern Node.js API template built with TypeScript, Express, Prisma, and MongoDB using functional programming patterns.

## Features

- ✅ **TypeScript** - Full type safety
- ✅ **Express.js** - Fast web framework
- ✅ **Prisma ORM** - Type-safe database client with MongoDB support
- ✅ **MongoDB** - NoSQL database integration via Prisma
- ✅ **Functional Programming** - No class components, pure functions
- ✅ **Error Handling** - Centralized error handling with `catchAsync` and `http-errors`
- ✅ **Health Check** - Server and database monitoring endpoint
- ✅ **ESLint & Prettier** - Code formatting and linting
- ✅ **Hot Reload** - Development server with nodemon
- ✅ **Logging** - Advanced logging with Winston and daily file rotation
- ✅ **Error Monitoring** - Sentry integration for production error tracking
- ✅ **CORS Support** - Cross-Origin Resource Sharing enabled
- ✅ **Environment Configuration** - Centralized environment variable management
- ✅ **Rate Limiting** - IP-based request rate limiting with configurable limits
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
DATABASE_URL="mongodb+srv://user:password@cluster.mongodb.net/mydb?retryWrites=true&w=majority"
SENTRY_DSN=your_sentry_dsn_here  # Optional for error monitoring
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

### Main API

- `GET /` - API status check

### Tasks API

- `GET /api/v1/tasks` - Get all tasks
- `POST /api/v1/tasks` - Create new task
- `GET /api/v1/tasks/:id` - Get task by ID
- `PATCH /api/v1/tasks/:id` - Update task
- `DELETE /api/v1/tasks/:id` - Delete task

### Debug Endpoints (Development Only)

- `GET /debug-sentry` - Test Sentry error tracking

## Project Structure

```
src/
├── controllers/        # Request handlers
├── models/            # Legacy models (can be removed if fully migrated)
├── routes/            # Route definitions
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

export const getTask = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    if (typeof id !== 'string') {
      return next(createError(400, 'Invalid task ID'));
    }

    const task = await prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      return next(createError(404, 'Task not found'));
    }

    res.status(200).json({
      status: 'success',
      data: task,
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
model Task {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  title       String
  description String
  completed   Boolean
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Generated TypeScript types are automatically available:

```typescript
import prisma from '../configs/prismaConfig';

// Fully type-safe database queries
const tasks = await prisma.task.findMany();
const task = await prisma.task.create({
  data: { title, description, completed },
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
- `cors` - Cross-origin resource sharing
- `dotenv` - Environment variable loading
- `http-errors` - HTTP error utilities
- `winston` & `winston-daily-rotate-file` - Advanced logging
- `@sentry/node` - Error monitoring and tracking
- `morgan` - HTTP request logging
- `cross-env` - Cross-platform environment variables
- `express-rate-limit` - Request rate limiting

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
SENTRY_DSN=https://...       # Sentry DSN (optional)
```

> **Important:** Prisma uses `DATABASE_URL` to connect to MongoDB. Make sure this is set correctly in your `.env` file.

### Log Files

The application automatically creates and manages log files in the `logs/` directory:

- `combined-YYYY-MM-DD-HH.log` - All application logs
- `error-YYYY-MM-DD-HH.log` - Error logs only
- Automatic compression and 14-day retention
- Maximum file size of 20MB

## Prisma Benefits

- **Type Safety**: Auto-generated TypeScript types for all database models
- **Auto-completion**: Full IDE support with intelligent auto-complete
- **Migration System**: Version-controlled database schema changes
- **Prisma Studio**: Visual database browser and editor
- **MongoDB Support**: Native MongoDB support with type-safe queries (Prisma 6.19)
- **Zero-cost Abstractions**: Minimal performance overhead

Perfect for developing scalable REST APIs with type-safe database access!
