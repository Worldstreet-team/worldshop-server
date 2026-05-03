import { describe, it, expect } from 'vitest';
import { PaymentProvider } from '../../../generated/prisma';
import {
  getPaymentProvider,
  registerPaymentProvider,
} from '../../services/payment/payment.service';
import type { PaymentServiceInterface } from '../../types/payment.types';

describe('provider registry', () => {
  it('can register and retrieve a mock payment provider', async () => {
    const fakeProvider: PaymentServiceInterface = {
      initializePayment: async (params) => ({
        transactionRef: 'test-ref',
        action: { type: 'redirect', url: 'https://example.com/pay' },
      }),
      verifyPayment: async () => ({
        status: 'success',
        transactionRef: 'test-ref',
        amount: 1000,
        paidAt: '',
        orders: [],
      }),
      handleWebhook: async () => ({ status: 'ignored' }),
    };

    // Register before retrieving
    registerPaymentProvider(PaymentProvider.MOCK, fakeProvider);
    const retrieved = getPaymentProvider(PaymentProvider.MOCK);

    expect(retrieved).toBeDefined();
    const result = await retrieved.initializePayment({
      checkoutSessionId: 'session-1',
      userId: 'user-1',
      userEmail: 'test@test.com',
      amount: 1000,
      currency: 'NGN',
    });
    expect(result.transactionRef).toBe('test-ref');
    expect(result.action.type).toBe('redirect');
  });
});
