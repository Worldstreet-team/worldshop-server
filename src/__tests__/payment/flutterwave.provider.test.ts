import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { PaymentProvider } from '../../../generated/prisma';
import { getPaymentProvider } from '../../services/payment/payment.service';

function signV3Webhook(body: string): string {
  const secret = process.env.FLW_SECRET_HASH || '';
  if (!secret) return '';
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('flutterwave provider', () => {
  it('Flutterwave provider is registered and handles webhooks', async () => {
    const provider = getPaymentProvider(PaymentProvider.FLUTTERWAVE);

    const webhookBody = JSON.stringify({
      event: 'charge.completed',
      data: {
        id: 12345,
        tx_ref: 'flw-ref-456',
        flw_ref: 'FLW123456',
        status: 'successful',
        amount: 5000,
        currency: 'NGN',
        meta: { checkoutSessionId: 'session-abc' },
      },
    });

    const result = await provider.handleWebhook(webhookBody, signV3Webhook(webhookBody));
    expect(result.status).toBe('completed');
    expect(result.checkoutSessionId).toBe('session-abc');
  });

  it('Flutterwave provider ignores non-charge events', async () => {
    const provider = getPaymentProvider(PaymentProvider.FLUTTERWAVE);

    const webhookBody = JSON.stringify({
      event: 'transfer.completed',
      data: { id: 999 },
    });

    const result = await provider.handleWebhook(webhookBody, signV3Webhook(webhookBody));
    expect(result.status).toBe('ignored');
  });

  it('Flutterwave provider returns failed for declined payments', async () => {
    const provider = getPaymentProvider(PaymentProvider.FLUTTERWAVE);

    const webhookBody = JSON.stringify({
      event: 'charge.completed',
      data: {
        id: 67890,
        tx_ref: 'flw-ref-789',
        flw_ref: 'FLW678901',
        status: 'failed',
        amount: 5000,
        currency: 'NGN',
        meta: { checkoutSessionId: 'session-def' },
      },
    });

    const result = await provider.handleWebhook(webhookBody, signV3Webhook(webhookBody));
    expect(result.status).toBe('failed');
    expect(result.checkoutSessionId).toBe('session-def');
  });
});
