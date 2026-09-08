import { CookieOptions, NextFunction, Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import * as authService from '../services/auth.service';
import { globalLog } from '../configs/loggerConfig';
import { CLIENT_URL, IS_PROD } from '../configs/envConfig';
import { ADMIN_SESSION_COOKIE } from '../utils/adminAuthTokens';
import type {
  AuthAdminLoginInput,
  AuthForgotPasswordInput,
  AuthResetPasswordInput,
  AuthSetupPasswordInput,
} from '../validators/auth.validator';

/** Last two labels of a hostname. Crude, but it only ever compares two hosts we own. */
function registrableDomain(host: string): string {
  const name = host.split(':')[0].toLowerCase();
  const labels = name.split('.');
  return labels.length <= 2 ? name : labels.slice(-2).join('.');
}

/**
 * SameSite is chosen per request rather than hardcoded, because the deployment
 * decides it. When the client and the API share a registrable domain
 * (shop.worldstreetgold.com to shop-api.worldstreetgold.com, or localhost:5173
 * to localhost:3000, where ports do not affect same-site) Lax is correct and
 * keeps the cookie off cross-site requests. When the client is pointed at a
 * different site, such as the raw *.onrender.com host, Lax cookies are never
 * sent back and the admin console appears to sign in and then immediately
 * bounce to the login page. None with Secure is the only thing that works
 * there.
 *
 * Lax is preferred when available: None means the cookie rides along on
 * cross-site requests, and Safari blocks it outright as a third-party cookie.
 * CSRF exposure under None stays small because the CORS allowlist blocks
 * credentialed XHR from other origins, and a form POST cannot send the JSON
 * content type these routes parse.
 *
 * No `domain` attribute: the cookie stays host-only to the API.
 *
 * Exported because clearing a cookie only works when every attribute matches
 * the ones it was set with.
 */
export function sessionCookieOptions(req: Request, expiresAt?: Date): CookieOptions {
  let clientHost = '';
  try {
    clientHost = new URL(CLIENT_URL || '').hostname;
  } catch {
    // CLIENT_URL unset or malformed; assume same-site and keep the stricter Lax.
  }

  const apiHost = req.get('host') || '';
  const crossSite =
    !!clientHost && !!apiHost && registrableDomain(apiHost) !== registrableDomain(clientHost);

  return {
    httpOnly: true,
    // SameSite=None is only honoured on a Secure cookie, so the two move together.
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite ? true : IS_PROD,
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

  res.cookie(ADMIN_SESSION_COOKIE, result.rawToken, sessionCookieOptions(req, result.expiresAt));

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
  res.clearCookie(ADMIN_SESSION_COOKIE, sessionCookieOptions(req));

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
