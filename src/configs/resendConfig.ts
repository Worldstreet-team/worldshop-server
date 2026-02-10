/**
 * Resend email client configuration.
 * @see https://resend.com/docs/send-with-express
 */
import { RESEND_API_KEY } from './envConfig';

export const resend = async () => {
  const { Resend } = await import('resend');
  return new Resend(RESEND_API_KEY!);
};