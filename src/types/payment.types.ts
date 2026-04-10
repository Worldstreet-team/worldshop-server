/**
 * Payment types for the backend.
 * Provider-agnostic payment service interface.
 */
import type { PaymentStatus } from '../../generated/prisma';

export { PaymentStatus } from '../../generated/prisma';

// ─── Provider types ─────────────────────────────────────────────
export type PaymentProviderType = 'mock' | 'crypto';

export type PaymentAction =
  | { type: 'redirect'; url: string }
  | { type: 'display'; instructions: string };

// ─── Payment response for API ───────────────────────────────────
export interface PaymentResponse {
  id: string;
  checkoutSessionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  transactionRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
}

// ─── Payment service interface ──────────────────────────────────
export interface InitPaymentParams {
  checkoutSessionId: string;
  userId: string;
  userEmail: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface InitPaymentResult {
  transactionRef: string;
  action: PaymentAction;
}

export interface VerifyPaymentResult {
  status: 'success' | 'failed' | 'pending';
  transactionRef: string;
  amount: number;
  paidAt: string;
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
  }>;
}

export interface WebhookResult {
  status: 'completed' | 'failed' | 'ignored';
}

export interface PaymentServiceInterface {
  initializePayment(params: InitPaymentParams): Promise<InitPaymentResult>;
  verifyPayment(transactionRef: string): Promise<VerifyPaymentResult>;
  handleWebhook(rawBody: string, signature: string): Promise<WebhookResult>;
}
