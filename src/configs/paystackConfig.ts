/**
 * Paystack API configuration and helpers.
 * All amounts are converted NGN → kobo before sending to Paystack.
 */
import { PAYSTACK_SECRET_KEY } from './envConfig';
import type {
  PaystackInitResponse,
  PaystackVerifyResponse,
} from '../types/payment.types';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getHeaders(): Record<string, string> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }
  return {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Initialize a Paystack transaction.
 * @param email - Customer email
 * @param amountNGN - Amount in NGN (will be converted to kobo)
 * @param reference - Unique payment reference
 * @param metadata - Optional metadata (orderId, userId, etc.)
 * @param callbackUrl - Redirect URL after payment
 */
export async function initializeTransaction(
  email: string,
  amountNGN: number,
  reference: string,
  metadata: Record<string, unknown>,
  callbackUrl: string
): Promise<PaystackInitResponse> {
  const amountKobo = Math.round(amountNGN * 100);

  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      email,
      amount: amountKobo,
      reference,
      currency: 'NGN',
      callback_url: callbackUrl,
      metadata,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Paystack initialize failed: ${(error as { message?: string }).message || response.statusText}`
    );
  }

  return response.json() as Promise<PaystackInitResponse>;
}

/**
 * Verify a Paystack transaction by reference.
 */
export async function verifyTransaction(
  reference: string
): Promise<PaystackVerifyResponse> {
  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Paystack verify failed: ${(error as { message?: string }).message || response.statusText}`
    );
  }

  return response.json() as Promise<PaystackVerifyResponse>;
}

/**
 * Verify the Paystack webhook signature.
 * Paystack signs webhooks with HMAC SHA-512 using your secret key.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const crypto = require('crypto') as typeof import('crypto');
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY || '')
    .update(body)
    .digest('hex');
  return hash === signature;
}
