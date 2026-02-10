/**
 * Resend email client configuration.
 * @see https://resend.com/docs/send-with-express
 */
import { Resend } from 'resend';
import { RESEND_API_KEY } from './envConfig';

export const resend = new Resend(RESEND_API_KEY!);
