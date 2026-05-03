import { createHmac } from 'crypto';
import type {
  PaymentServiceInterface,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentResult,
  WebhookResult,
} from '../../../types/payment.types';
import { globalLog as logger } from '../../../configs/loggerConfig';

const FLW_SECRET_HASH = process.env.FLW_SECRET_HASH || '';
const FLW_BASE_URL = process.env.FLW_ENVIRONMENT === 'production'
  ? 'https://api.flutterwave.com'
  : 'https://developersandbox-api.flutterwave.com';
const FLW_AUTH_URL = 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token';

interface FlwTokenResponse {
  access_token: string;
  expires_in: number;
}

interface FlwChargeResponse {
  status: string;
  message: string;
  data: {
    id: string;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    next_action?: {
      type: string;
      redirect_url?: { url: string };
    };
    meta?: {
      authorization?: { redirect?: string };
    };
    created_at?: string;
  };
}

interface FlwWebhookPayload {
  type: string;
  id?: string;
  data: {
    id?: string;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    meta?: { checkoutSessionId?: string };
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.FLW_CLIENT_ID;
  const clientSecret = process.env.FLW_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FLW_CLIENT_ID and FLW_CLIENT_SECRET environment variables are required');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetch(FLW_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Flutterwave auth failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as FlwTokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

export const flutterwavePaymentProvider: PaymentServiceInterface = {
  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const token = await getAccessToken();
    const rawOrderNumbers = params.metadata?.orderNumbers as string[] | undefined;
    const transactionRef = rawOrderNumbers?.[0] || `WS-PAY-${Date.now()}`;

    const chargeBody = {
      reference: transactionRef,
      amount: params.amount,
      currency: params.currency,
      redirect_url: `${params.metadata?.redirectBase || process.env.CLIENT_URL || ''}/checkout/callback`,
      meta: {
        checkoutSessionId: params.checkoutSessionId,
      },
      customer: {
        email: params.userEmail,
      },
    };

    const response = await fetch(`${FLW_BASE_URL}/charges`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(chargeBody),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Flutterwave charge creation failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as FlwChargeResponse;

    let redirectUrl: string;
    if (data.data.next_action?.redirect_url?.url) {
      redirectUrl = data.data.next_action.redirect_url.url;
    } else if (data.data.meta?.authorization?.redirect) {
      redirectUrl = data.data.meta.authorization.redirect;
    } else {
      redirectUrl = `${FLW_BASE_URL}/pay/${transactionRef}`;
    }

    return {
      transactionRef,
      action: { type: 'redirect', url: redirectUrl },
    };
  },

  async verifyPayment(transactionRef: string): Promise<VerifyPaymentResult> {
    const token = await getAccessToken();

    const response = await fetch(`${FLW_BASE_URL}/charges/${encodeURIComponent(transactionRef)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Flutterwave verification failed: ${response.status}`);
    }

    const data = (await response.json()) as FlwChargeResponse;

    return {
      status: data.data.status === 'succeeded' ? 'success'
        : data.data.status === 'failed' ? 'failed'
        : 'pending',
      transactionRef: data.data.reference || transactionRef,
      amount: data.data.amount || 0,
      paidAt: data.data.created_at || '',
      orders: [],
    };
  },

  async handleWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
    if (FLW_SECRET_HASH) {
      const expected = createHmac('sha256', FLW_SECRET_HASH)
        .update(rawBody)
        .digest('base64');
      if (signature !== expected) {
        logger.warn('[Flutterwave Webhook] Invalid signature — rejecting payload');
        return { status: 'ignored' };
      }
    }

    let body: FlwWebhookPayload;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { status: 'ignored' };
    }

    if (body.type !== 'charge.completed') {
      return { status: 'ignored' };
    }

    const { data } = body;
    if (!data.reference) {
      return { status: 'ignored' };
    }

    const checkoutSessionId = data.meta?.checkoutSessionId || '';

    if (data.status === 'succeeded') {
      return { status: 'completed', checkoutSessionId };
    }

    if (data.status === 'failed') {
      return { status: 'failed', checkoutSessionId };
    }

    return { status: 'ignored' };
  },
};
