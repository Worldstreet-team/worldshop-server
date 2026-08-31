import express, { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';

import taskRoutes from './routes/taskRoutes';
import profileRoutes from './routes/profile.routes';
import categoryRoutes from './routes/category.routes';
import adminRoutes from './routes/admin.routes';
import marketplaceStoreRoutes from './routes/marketplace.store.routes';
import mallRoutes from './routes/mall.routes';
import listingPublicRoutes from './routes/listing.public.routes';
import chatRoutes from './routes/chat.routes';
import marketplaceReviewRoutes from './routes/marketplace.review.routes';
import reportRoutes from './routes/report.routes';
import catchAll404Errors from './middlewares/catchAll404Errors';
import globalErrorHandler from './middlewares/errorHandler';
import { healthCheck } from './utils/health';
import { connectDatabase } from './configs/prismaConfig';
import { rateLimiter } from './configs/rateLimitConfig';
import { CLIENT_URL, NODE_ENV } from './configs/envConfig';

import './configs/sentryConfig';

const app = express();

// connect to DB
connectDatabase();

// Rate limiting - Apply to all requests
app.use(rateLimiter);

// CORS — allow the shop client + localhost in dev
const allowedOrigins = [
  CLIENT_URL || 'https://shop.worldstreetgold.com',
  ...(NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
].filter(Boolean) as string[];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
}));

// Clerk middleware — verifies session tokens on every request
app.use(clerkMiddleware());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get('/', async (req: Request, res: Response, next: NextFunction) => {
  res.status(200).send({
    status: 'success',
    name: 'WorldStore API',
    version: 'v1',
    description: 'Backend API for the WorldStore marketplace.',
    health: '/health',
    baseUrl: '/api/v1',
    endpoints: {
      listings: '/api/v1/listings',
      stores: '/api/v1/stores',
      malls: '/api/v1/malls',
      categories: '/api/v1/categories',
      conversations: '/api/v1/conversations',
      reviews: '/api/v1/reviews',
      reports: '/api/v1/reports',
      profile: '/api/v1/profile',
      admin: '/api/v1/admin',
    },
  });
});

app.use('/health', healthCheck);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/stores', marketplaceStoreRoutes);
app.use('/api/v1/malls', mallRoutes);
app.use('/api/v1/listings', listingPublicRoutes);
app.use('/api/v1/conversations', chatRoutes);
app.use('/api/v1/reviews', marketplaceReviewRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/admin', adminRoutes);

// Error handlers
Sentry.setupExpressErrorHandler(app); // sentry error handler middleware

app.use(catchAll404Errors); // Catch all 404 errors...

app.use(globalErrorHandler); // Catch all errors...

export default app;
