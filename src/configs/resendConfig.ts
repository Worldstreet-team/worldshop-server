/**
 * Resend email client configuration.
 * Uses the official Resend Node.js SDK.
 * @see https://resend.com/docs/send-with-express
 *
 * Lazy-loads the SDK to avoid runtime crashes if the package
 * is missing in the deploy environment.
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

let cachedClient: ResendClient | null = null;

function getResendClient(): ResendClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  if (!RESEND_API_KEY) {
    console.warn('[Resend] RESEND_API_KEY is not set — emails will be skipped');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resend } = require('resend') as { Resend: new (key: string) => ResendClient };
    cachedClient = new Resend(RESEND_API_KEY);
    return cachedClient;
  } catch (error) {
    console.warn('[Resend] Package not available — emails will be skipped');
    return null;
  }
}

export const resend: ResendClient = {
  emails: {
    send: async (options: SendEmailOptions) => {
      const client = getResendClient();
      if (!client) {
        return {
          data: null,
          error: { message: 'Resend unavailable', name: 'ResendUnavailable' },
        };
      }
      return client.emails.send(options);
    },
  },
};
