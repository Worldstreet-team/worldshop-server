import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller';
import { requireAdminSession } from '../middlewares/adminSession.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  authAdminLoginSchema,
  authForgotPasswordSchema,
  authResetPasswordSchema,
  authSetupPasswordSchema,
} from '../validators/auth.validator';

/**
 * Admin credential auth. Everything else in the app authenticates through
 * Clerk; this is the console's own login, password setup and reset.
 *
 * The global limiter (10k / 15 min) is meant for ordinary browsing and does
 * nothing for a password guesser, so these routes carry their own.
 */
const router = Router();

const limiter = (max: number, message: string) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

const loginLimiter = limiter(10, 'Too many sign-in attempts. Try again in 15 minutes.');
const forgotLimiter = limiter(5, 'Too many requests. Try again in 15 minutes.');
const tokenLimiter = limiter(10, 'Too many attempts. Try again in 15 minutes.');

// Validation runs as middleware, not inside the controllers. A ZodError thrown
// from a controller reaches the global handler, which has no statusCode for it
// and answers 500 with the raw issue list as the message; validate() turns the
// same failure into a 400 with per-field messages the forms can render.

// ─── Admin session ──────────────────────────────────────────────
router.post('/admin/login', loginLimiter, validate(authAdminLoginSchema), authController.adminLogin);
router.get('/admin/me', requireAdminSession, authController.adminMe);
router.post('/admin/logout', authController.adminLogout);

// ─── Password setup and recovery ────────────────────────────────
// One entry point for both: forgot-password sends a setup link to an admin who
// has never had a password, and a reset link to one who has.
router.post('/forgot-password', forgotLimiter, validate(authForgotPasswordSchema), authController.forgotPassword);
router.post('/setup-password', tokenLimiter, validate(authSetupPasswordSchema), authController.setupPassword);
router.post('/reset-password', tokenLimiter, validate(authResetPasswordSchema), authController.resetPassword);

export default router;
