import type { PaymentProvider as PaymentProviderEnum } from '../../../generated/prisma';
import type { PaymentServiceInterface, PaymentProviderType } from '../../types/payment.types';
import { mockPaymentProvider } from './providers/mock.provider';
import { flutterwavePaymentProvider } from './providers/flutterwave.provider';

const providerRegistry = new Map<PaymentProviderType, PaymentServiceInterface>();

function registerProvider(name: PaymentProviderType, provider: PaymentServiceInterface): void {
  providerRegistry.set(name, provider);
}

function getRegisteredProvider(name: PaymentProviderType): PaymentServiceInterface {
  const provider = providerRegistry.get(name);
  if (!provider) {
    return mockPaymentProvider;
  }
  return provider;
}

registerProvider('MOCK' as PaymentProviderType, mockPaymentProvider);
registerProvider('FLUTTERWAVE' as PaymentProviderType, flutterwavePaymentProvider);
registerProvider('CRYPTO' as PaymentProviderType, mockPaymentProvider);

const paymentProviders = {
  register: registerProvider,
  get: getRegisteredProvider,
};

export const registerPaymentProvider = paymentProviders.register;
export const getPaymentProvider = paymentProviders.get;
