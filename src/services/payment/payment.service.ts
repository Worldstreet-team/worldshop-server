import createError from 'http-errors';
import type { PaymentServiceInterface, PaymentProviderType } from '../../types/payment.types';
import { mockPaymentProvider } from './providers/mock.provider';
import { flutterwavePaymentProvider } from './providers/flutterwave.provider';
import { walletPaymentProvider } from './providers/wallet.provider';

const providerRegistry = new Map<PaymentProviderType, PaymentServiceInterface>();

function registerProvider(name: PaymentProviderType, provider: PaymentServiceInterface): void {
  providerRegistry.set(name, provider);
}

function getRegisteredProvider(name: PaymentProviderType): PaymentServiceInterface {
  const provider = providerRegistry.get(name);
  if (!provider) {
    // No silent mock fallback — an unregistered provider must never be able
    // to complete an order for free.
    throw createError(400, 'Payment provider not available');
  }
  return provider;
}

registerProvider('MOCK' as PaymentProviderType, mockPaymentProvider);
// Kept registered so pre-cutover FLUTTERWAVE payments can still verify;
// new payments are wallet-only (see ALLOWED_PROVIDERS in the orchestrator).
registerProvider('FLUTTERWAVE' as PaymentProviderType, flutterwavePaymentProvider);
registerProvider('WALLET' as PaymentProviderType, walletPaymentProvider);

const paymentProviders = {
  register: registerProvider,
  get: getRegisteredProvider,
};

export const registerPaymentProvider = paymentProviders.register;
export const getPaymentProvider = paymentProviders.get;
