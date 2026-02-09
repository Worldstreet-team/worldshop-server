/**
 * Resend email client configuration.
 * Uses the official Resend Node.js SDK.
 * @see https://resend.com/docs/send-with-express
 *
 * We use require() to avoid TS2307 on environments where the
 * 'resend' type declarations are not resolved (e.g. Render).
 */
import { RESEND_API_KEY } from './envConfig';

interface SendEmailOptions {
  from: string;
  to: string[];
  subject: string;
  html: string;
}

interface SendEmailResponse {
  data: { id: string } | null;
  error: { message: string; name: string } | null;
}

interface ResendClient {
  emails: {
    send(options: SendEmailOptions): Promise<SendEmailResponse>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Resend } = require('resend') as { Resend: new (key: string) => ResendClient };

export const resend: ResendClient = new Resend(RESEND_API_KEY || '');
