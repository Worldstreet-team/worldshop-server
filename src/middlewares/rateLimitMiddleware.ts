import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { globalLog } from '../configs/loggerConfig';
import { NODE_ENV } from '../configs/envConfig';

// Dynamic rate limiter based on user authentication status
export const createDynamicRateLimiter = (authenticatedMax: number, guestMax: number) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req: Request) => {
      // If user is authenticated (you can check for JWT token, session, etc.)
      // For now, we'll use a simple check - you can modify this based on your auth implementation
      const isAuthenticated = req.headers.authorization || req.headers['x-auth-token'];
      
      if (isAuthenticated) {
        return NODE_ENV === 'production' ? authenticatedMax : authenticatedMax * 10;
      }
      return NODE_ENV === 'production' ? guestMax : guestMax * 10;
    },
    message: {
      status: 'error',
      message: 'Rate limit exceeded. Consider signing in for higher limits.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const isAuthenticated = req.headers.authorization || req.headers['x-auth-token'];
      globalLog.warn(
        `Dynamic rate limit exceeded for ${isAuthenticated ? 'authenticated' : 'guest'} user from IP: ${req.ip} on route: ${req.originalUrl}`
      );
      res.status(429).json({
        status: 'error',
        message: 'Rate limit exceeded. Consider signing in for higher limits.',
      });
    },
  });
};

// Rate limiting info middleware - adds rate limit info to response headers
export const rateLimitInfo = (req: Request, res: Response, next: NextFunction) => {
  // Add custom headers with rate limit information
  res.setHeader('X-RateLimit-Policy', 'Dynamic based on authentication');
  res.setHeader('X-RateLimit-Environment', NODE_ENV || 'development');
  
  next();
};

// Skip rate limiting for certain conditions (e.g., internal requests, health checks)
export const skipRateLimitFor = (paths: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting for specified paths
    if (paths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    // Skip for localhost in development
    if (NODE_ENV !== 'production' && (req.ip === '127.0.0.1' || req.ip === '::1')) {
      return next();
    }
    
    next();
  };
};

// Rate limit bypass for trusted IPs (you can add your trusted IPs here)
export const trustedIPs = ['127.0.0.1', '::1']; // Add your trusted IPs

export const bypassRateLimitForTrustedIPs = (req: Request, res: Response, next: NextFunction) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  if (trustedIPs.includes(clientIP)) {
    // Skip rate limiting for trusted IPs
    return next();
  }
  next();
};
