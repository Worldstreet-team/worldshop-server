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
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || '';
const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

interface FlwInitResponse {
  status: string;
  message: string;
  data: {
    link: string;
  };
}

interface FlwVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number;
    currency: string;
    charged_amount: number;
    status: string;
    payment_type: string;
    created_at: string;
    meta?: Record<string, unknown>;
  };
}

interface FlwWebhookPayload {
  event: string;
  data: {
    id?: number;
    tx_ref?: string;
    flw_ref?: string;
    status?: string;
    amount?: number;
    currency?: string;
    meta?: Record<string, unknown>;
  };
}

export const flutterwavePaymentProvider: PaymentServiceInterface = {
  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    if (!FLW_SECRET_KEY) {
      throw new Error('FLW_SECRET_KEY environment variable is required');
    }

    const rawOrderNumbers = params.metadata?.orderNumbers as string[] | undefined;
    const txRef = rawOrderNumbers?.[0] || `WS-PAY-${Date.now()}`;

    const body = {
      tx_ref: txRef,
      amount: params.amount,
      currency: params.currency,
      redirect_url: `${process.env.CLIENT_URL || ''}/checkout/callback`,
      customer: {
        email: params.userEmail,
      },
      meta: {
        checkoutSessionId: params.checkoutSessionId,
        ...params.metadata,
      },
    };

    const response = await fetch(`${FLW_BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FLW_SECRET_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Flutterwave init failed: ${response.status} ${err}`);
    }

    const json = (await response.json()) as FlwInitResponse;
    const link = json.data?.link;

    if (!link) {
      throw new Error('Flutterwave did not return a payment link');
    }

    return {
      transactionRef: txRef,
      action: { type: 'redirect', url: link },
    };
  },

  async verifyPayment(transactionRef: string): Promise<VerifyPaymentResult> {
    if (!FLW_SECRET_KEY) {
      throw new Error('FLW_SECRET_KEY environment variable is required');
    }

    const url = `${FLW_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(transactionRef)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
    });

    if (!response.ok) {
      throw new Error(`Flutterwave verification failed: ${response.status}`);
    }

    const json = (await response.json()) as FlwVerifyResponse;
    const data = json.data;

    return {
      status: data?.status === 'successful' ? 'success'
        : data?.status === 'failed' ? 'failed'
        : 'pending',
      transactionRef: data?.tx_ref || transactionRef,
      amount: data?.amount || 0,
      paidAt: data?.created_at || '',
      orders: [],
    };
  },

  async handleWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
    if (FLW_SECRET_HASH) {
      const expectedHex = createHmac('sha256', FLW_SECRET_HASH)
        .update(rawBody)
        .digest('hex');
      const expectedBase64 = createHmac('sha256', FLW_SECRET_HASH)
        .update(rawBody)
        .digest('base64');
      if (signature !== expectedHex && signature !== expectedBase64) {
        logger.warn('[Flutterwave Webhook] Invalid signature — rejecting payload');
        return { status: 'ignored' };
      }
    }

    let payload: FlwWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 'ignored' };
    }

    if (payload.event !== 'charge.completed') {
      return { status: 'ignored' };
    }

    const data = payload.data;
    if (!data?.tx_ref) {
      return { status: 'ignored' };
    }

    const checkoutSessionId =
      (data.meta?.checkoutSessionId as string) || '';

    if (data.status === 'successful') {
      return { status: 'completed', checkoutSessionId };
    }

    if (data.status === 'failed') {
      return { status: 'failed', checkoutSessionId };
    }

    return { status: 'ignored' };
  },
};
