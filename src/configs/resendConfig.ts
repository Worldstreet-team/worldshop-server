/**
 * Resend email client configuration.
 */
import { Resend } from 'resend';
import { RESEND_API_KEY } from './envConfig';

if (!RESEND_API_KEY) {
  console.warn('[Resend] RESEND_API_KEY is not set — emails will be skipped');
}

export const resend = new Resend(RESEND_API_KEY || '');
