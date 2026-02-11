import express, { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import taskRoutes from './routes/taskRoutes';
import profileRoutes from './routes/profile.routes';
import productRoutes from './routes/product.routes';
import categoryRoutes from './routes/category.routes';
import cartRoutes from './routes/cart.routes';
import addressRoutes from './routes/address.routes';
import checkoutRoutes from './routes/checkout.routes';
import orderRoutes from './routes/order.routes';
import paymentRoutes from './routes/payment.routes';
import reviewRoutes from './routes/review.routes';
import wishlistRoutes from './routes/wishlist.routes';
import adminRoutes from './routes/admin.routes';
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

// Parse cookies (needed for HttpOnly JWT cookies)
app.use(cookieParser());

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get('/', async (req: Request, res: Response, next: NextFunction) => {
  res.status(200).send({
    status: 'success',
    name: 'WorldStreet Shop API',
    version: 'v1',
    description: 'Backend API for WorldStreet Shop ecommerce platform.',
    health: '/health',
    baseUrl: '/api/v1',
    endpoints: {
      profile: '/api/v1/profile',
      products: '/api/v1/products',
      categories: '/api/v1/categories',
      cart: '/api/v1/cart',
      addresses: '/api/v1/addresses',
      checkout: '/api/v1/checkout',
      orders: '/api/v1/orders',
      payments: '/api/v1/payments',
      reviews: '/api/v1/products/:productId/reviews',
      wishlist: '/api/v1/wishlist',
      admin: '/api/v1/admin',
    },
  });
});

app.use('/health', healthCheck);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/products/:productId/reviews', reviewRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/admin', adminRoutes);

app.get('/debug-sentry', (req, res) => {
  throw new Error('My first Sentry error!');
});

// Error handlers
Sentry.setupExpressErrorHandler(app); // sentry error handler middleware

app.use(catchAll404Errors); // Catch all 404 errors...

app.use(globalErrorHandler); // Catch all errors...

export default app;
