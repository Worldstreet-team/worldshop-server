import { describe, it, expect } from 'vitest';
import { PaymentProvider } from '../../../generated/prisma';
import { getPaymentProvider } from '../../services/payment/payment.service';

describe('flutterwave provider', () => {
  it('Flutterwave provider is registered and handles webhooks', async () => {
    const provider = getPaymentProvider(PaymentProvider.FLUTTERWAVE);

    const webhookBody = JSON.stringify({
      type: 'charge.completed',
      id: 'wbk_abc',
      data: {
        id: 'chg_123',
        reference: 'flw-ref-456',
        status: 'succeeded',
        amount: 5000,
        currency: 'NGN',
        meta: { checkoutSessionId: 'session-abc' },
      },
    });

    const result = await provider.handleWebhook(webhookBody, 'fw-signature');
    expect(result.status).toBe('completed');
    expect(result.checkoutSessionId).toBe('session-abc');
  });

  it('Flutterwave provider ignores non-charge events', async () => {
    const provider = getPaymentProvider(PaymentProvider.FLUTTERWAVE);

    const webhookBody = JSON.stringify({
      type: 'transfer.completed',
      data: { id: 'trf_123' },
    });

    const result = await provider.handleWebhook(webhookBody, 'sig');
    expect(result.status).toBe('ignored');
  });

  it('Flutterwave provider returns failed for declined payments', async () => {
    const provider = getPaymentProvider(PaymentProvider.FLUTTERWAVE);

    const webhookBody = JSON.stringify({
      type: 'charge.completed',
      id: 'wbk_def',
      data: {
        id: 'chg_456',
        reference: 'flw-ref-789',
        status: 'failed',
        amount: 5000,
        currency: 'NGN',
        meta: { checkoutSessionId: 'session-def' },
      },
    });

    const result = await provider.handleWebhook(webhookBody, 'sig');
    expect(result.status).toBe('failed');
    expect(result.checkoutSessionId).toBe('session-def');
  });
});
