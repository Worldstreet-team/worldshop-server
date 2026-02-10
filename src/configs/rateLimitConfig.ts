import rateLimit from 'express-rate-limit';
import { NODE_ENV } from './envConfig';

// Simple rate limiter for all routes
export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // 10000 requests per 15 minutes in production and development
  message: {
    status: 'error',
    message: 'Too many requests, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable legacy headers
});
