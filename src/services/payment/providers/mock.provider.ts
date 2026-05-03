import { createHmac } from 'crypto';
import { CLIENT_URL, PAYMENT_WEBHOOK_SECRET } from '../../../configs/envConfig';
import { globalLog as logger } from '../../../configs/loggerConfig';
import type {
  PaymentServiceInterface,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentResult,
  WebhookResult,
} from '../../../types/payment.types';

function generateTransactionRef(): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `WS-PAY-${uuid.slice(0, 16)}`;
}

export const mockPaymentProvider: PaymentServiceInterface = {
  initializePayment(params: InitPaymentParams): InitPaymentResult {
    const transactionRef = generateTransactionRef();
    const clientUrl = CLIENT_URL || 'http://localhost:5173';
    const redirectUrl = `${clientUrl}/checkout/mock-payment?session=${params.checkoutSessionId}&ref=${transactionRef}`;

    return {
      transactionRef,
      action: { type: 'redirect', url: redirectUrl },
    };
  },

  verifyPayment(): VerifyPaymentResult {
    throw new Error('Mock provider verifyPayment should not be called directly — use orchestrator');
  },

  handleWebhook(rawBody: string, signature: string): WebhookResult {
    if (PAYMENT_WEBHOOK_SECRET) {
      const expected = createHmac('sha256', PAYMENT_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
      if (signature !== expected) {
        logger.warn('[Webhook] Invalid signature — rejecting payload');
        return { status: 'ignored' };
      }
    } else {
      logger.warn('[Webhook] PAYMENT_WEBHOOK_SECRET not configured — skipping signature check in dev mode');
    }

    let body: { checkoutSessionId: string; action: 'confirm' | 'decline' };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { status: 'ignored' };
    }

    const { checkoutSessionId, action } = body;
    if (!checkoutSessionId || !action) {
      return { status: 'ignored' };
    }

    if (action === 'confirm') {
      return { status: 'completed', checkoutSessionId };
    }

    if (action === 'decline') {
      return { status: 'failed', checkoutSessionId };
    }

    return { status: 'ignored' };
  },
};
