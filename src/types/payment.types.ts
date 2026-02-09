/**
 * Payment types for the backend.
 * Align with Prisma schema and Paystack API contracts.
 */
import type { PaymentStatus } from '../../generated/prisma';

export { PaymentStatus } from '../../generated/prisma';

// ─── Payment response for API ───────────────────────────────────
export interface PaymentResponse {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  reference: string | null;
  paystackId: string | null;
  channel: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
}

// ─── Initialize payment result ──────────────────────────────────
export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

// ─── Verify payment result ──────────────────────────────────────
export interface VerifyPaymentResult {
  status: string;
  reference: string;
  amount: number;      // in NGN (converted back from kobo)
  channel: string;
  paidAt: string;
  order: {
    id: string;
    orderNumber: string;
    status: string;
  };
}

// ─── Paystack API response shapes ───────────────────────────────
export interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string;          // "success", "failed", "abandoned"
    reference: string;
    amount: number;          // in kobo
    currency: string;
    channel: string;
    paid_at: string;
    customer: {
      email: string;
    };
    metadata?: Record<string, unknown>;
  };
}

export interface PaystackWebhookEvent {
  event: string;             // "charge.success", "charge.failed", etc.
  data: {
    id: number;
    status: string;
    reference: string;
    amount: number;          // in kobo
    currency: string;
    channel: string;
    paid_at: string;
    customer: {
      email: string;
    };
    metadata?: Record<string, unknown>;
  };
}
