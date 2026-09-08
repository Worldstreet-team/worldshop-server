import { CookieOptions, NextFunction, Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import * as authService from '../services/auth.service';
import { globalLog } from '../configs/loggerConfig';
import { IS_PROD } from '../configs/envConfig';
import { ADMIN_SESSION_COOKIE } from '../utils/adminAuthTokens';
import type {
  AuthAdminLoginInput,
  AuthForgotPasswordInput,
  AuthResetPasswordInput,
  AuthSetupPasswordInput,
} from '../validators/auth.validator';

/**
 * SameSite=Lax is enough because the API and the client share a registrable
 * domain in both environments — shop.worldstreetgold.com talks to
 * shop-api.worldstreetgold.com, and localhost:5173 to localhost:3000 (ports do
 * not affect same-site). Pointing the client at a raw *.onrender.com host would
 * make the cookie cross-site and browsers would drop it.
 *
 * No `domain` attribute: the cookie stays host-only to the API.
 *
 * Exported because clearing a cookie only works when every attribute matches
 * the ones it was set with.
 */
export function sessionCookieOptions(expiresAt?: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

export const adminLogin = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = req.body as AuthAdminLoginInput;
  const result = await authService.adminLogin(input.email, input.password);

  if (result.outcome === 'SETUP_REQUIRED') {
    res.status(403).json({
      success: false,
      passwordSetupRequired: true,
      message:
        'This admin account does not have a password yet. Check your email for a link to set one up.',
    });
    return;
  }

  res.cookie(ADMIN_SESSION_COOKIE, result.rawToken, sessionCookieOptions(result.expiresAt));

  res.status(200).json({
    success: true,
    data: { user: result.user },
    message: 'Signed in.',
  });
});

export const adminMe = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  res.status(200).json({ success: true, data: { user: req.user } });
});

export const adminLogout = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const raw = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (raw) await authService.logout(raw);

  // Attributes must match the ones the cookie was set with or the clear is ignored.
  res.clearCookie(ADMIN_SESSION_COOKIE, sessionCookieOptions());

  res.status(200).json({ success: true, data: null, message: 'Signed out.' });
});

/**
 * Answers before doing any work. Both the body and the response time would
 * otherwise reveal whether an address belongs to an admin — sending mail takes
 * long enough to measure.
 */
export const forgotPassword = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = req.body as AuthForgotPasswordInput;

  res.status(200).json({
    success: true,
    data: null,
    message: 'If an admin account exists for that email, we have sent a link to set a password.',
  });

  authService.forgotPassword(input.email).catch((err: unknown) => {
    globalLog.error('forgotPassword failed', { message: (err as Error)?.message });
  });
});

export const setupPassword = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = req.body as AuthSetupPasswordInput;
  await authService.setupPassword(input.token, input.password);

  res.status(200).json({
    success: true,
    data: null,
    message: 'Password created. You can now sign in.',
  });
});

export const resetPassword = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = req.body as AuthResetPasswordInput;
  await authService.resetPassword(input.token, input.password);

  res.status(200).json({
    success: true,
    data: null,
    message: 'Password updated. You can now sign in.',
  });
});
