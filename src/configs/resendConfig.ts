/**
 * Resend email client configuration.
 * Loaded lazily so missing dependency won't crash runtime.
 */
import { RESEND_API_KEY } from './envConfig';

type ResendEmailOptions = {
  from: string;
  to: string[];
  subject: string;
  html: string;
};

type ResendClient = {
  emails: {
    send: (options: ResendEmailOptions) => Promise<{ error?: { message: string } }>;
  };
};

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
    send: async (options: ResendEmailOptions) => {
      const client = getResendClient();
      if (!client) {
        return { error: { message: 'Resend unavailable' } };
      }
      return client.emails.send(options);
    },
  },
};
