import createError from 'http-errors';
import type {
  PaymentServiceInterface,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentResult,
  WebhookResult,
} from '../../../types/payment.types';
import { globalLog as logger } from '../../../configs/loggerConfig';

/**
 * WALLET provider — pays a checkout from the buyer's central WorldStreet
 * wallet by charging the worldstreet-wallet service server-to-server.
 *
 * The wallet's spend API is USD-only while the shop prices in NGN, so the
 * order total is converted at charge time using the same public rate source
 * the wallet service itself uses for NGN-funded deposits (CoinGecko
 * USDT/NGN ≈ USD/NGN). The rate and both amounts are snapshotted in the
 * charge metadata; USD cents round UP so conversion never undercharges.
 *
 * Unlike redirect providers the charge is synchronous: by the time
 * `initializePayment` returns, the money has moved. Verification reads the
 * charge back and reports the NGN amount (the orchestrator compares it
 * against `Payment.amount`, which is NGN). There are no webhooks.
 */

const WALLET_API_URL = (process.env.WALLET_API_URL || '').replace(/\/+$/, '');
const WALLET_SERVICE_TOKEN = process.env.WALLET_SERVICE_TOKEN || '';

const REF_PREFIX = 'WSWALLET';

// ── FX: USD/NGN with a short TTL cache (mirrors the wallet's fx-actions) ──

const FX_TTL_MS = 120_000;
let fxCache: { at: number; rate: number } | null = null;

export async function getUsdNgnRate(): Promise<number> {
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS) return fxCache.rate;

  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn',
    { signal: AbortSignal.timeout(5_000) },
  ).catch(() => null);

  if (res?.ok) {
    const data = (await res.json()) as { tether?: { ngn?: number } };
    const ngn = data?.tether?.ngn;
    if (typeof ngn === 'number' && ngn > 0) {
      fxCache = { at: Date.now(), rate: Math.round(ngn) };
      return fxCache.rate;
    }
  }

  // A stale rate beats no rate — better to quote slightly off than to block
  // checkout on a third-party hiccup. Hard-fail only with nothing cached.
  if (fxCache) {
    logger.warn('[Wallet] FX refresh failed — using stale USD/NGN rate', {
      ageMs: Date.now() - fxCache.at,
    });
    return fxCache.rate;
  }
  throw createError(503, 'Exchange rate unavailable — try again shortly or pay by card');
}

/** NGN → USD cents, rounded up so the platform never undercharges. */
export function ngnToUsdMinor(amountNgn: number, rate: number): number {
  return Math.ceil((amountNgn / rate) * 100);
}

// ── Wallet service client ──

type WalletCharge = {
  id: string;
  status: 'succeeded' | 'refunded' | string;
  amountMinor: number;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

async function walletRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  if (!WALLET_API_URL || !WALLET_SERVICE_TOKEN) {
    throw createError(503, 'Wallet payments are not configured on this server');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Wallet-Service-Token': WALLET_SERVICE_TOKEN,
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`${WALLET_API_URL}${path}`, {
    method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });

  const json = (await res.json().catch(() => null)) as
    | ({ ok: boolean; code?: string; error?: string } & Record<string, unknown>)
    | null;

  if (!json || json.ok !== true) {
    const code = json?.code || `HTTP_${res.status}`;
    const message = json?.error || 'Wallet service request failed';
    if (code === 'INSUFFICIENT_BALANCE') {
      throw createError(409, 'Insufficient wallet balance for this order. Top up your dollar balance or pay by card.');
    }
    logger.error('[Wallet] Service call failed', { path, code, message });
    throw createError(502, `Wallet payment failed: ${message}`);
  }

  return json as T;
}

// ── Composite transaction ref ──
// verifyPayment only receives the ref, but reading a charge back needs the
// spender's userId in the path — so both ride in the ref.

function buildRef(userId: string, chargeId: string): string {
  return `${REF_PREFIX}:${userId}:${chargeId}`;
}

function parseRef(ref: string): { userId: string; chargeId: string } {
  const [prefix, userId, chargeId] = ref.split(':');
  if (prefix !== REF_PREFIX || !userId || !chargeId) {
    throw createError(400, 'Not a wallet payment reference');
  }
  return { userId, chargeId };
}

// ── Provider ──

export const walletPaymentProvider: PaymentServiceInterface = {
  async initializePayment(params: InitPaymentParams): Promise<InitPaymentResult> {
    const rate = await getUsdNgnRate();
    const usdMinor = ngnToUsdMinor(params.amount, rate);
    const orderNumbers = (params.metadata?.orderNumbers as string[] | undefined) ?? [];

    const { charge } = await walletRequest<{ charge: WalletCharge }>(
      'POST',
      `/v1/wallet/${encodeURIComponent(params.userId)}/charges`,
      {
        // Same checkout session → same key → the wallet replays the original
        // charge instead of double-debiting on retries.
        idempotencyKey: `worldshop:${params.checkoutSessionId}`,
        body: {
          amountMinor: usdMinor,
          currency: 'USD',
          description: `WorldShop order ${orderNumbers.join(', ') || params.checkoutSessionId}`,
          metadata: {
            checkoutSessionId: params.checkoutSessionId,
            amountNgn: params.amount,
            fxRate: rate,
            orderNumbers,
          },
        },
      },
    );

    logger.info('[Wallet] Charge succeeded', {
      checkoutSessionId: params.checkoutSessionId,
      chargeId: charge.id,
      usdMinor,
      amountNgn: params.amount,
      fxRate: rate,
    });

    return {
      transactionRef: buildRef(params.userId, charge.id),
      action: {
        type: 'display',
        instructions: `Paid $${(usdMinor / 100).toFixed(2)} from your WorldStreet wallet (₦${params.amount.toLocaleString()} at ₦${rate}/$).`,
      },
    };
  },

  async verifyPayment(transactionRef: string): Promise<VerifyPaymentResult> {
    const { userId, chargeId } = parseRef(transactionRef);

    const { charge } = await walletRequest<{ charge: WalletCharge }>(
      'GET',
      `/v1/wallet/${encodeURIComponent(userId)}/charges/${encodeURIComponent(chargeId)}`,
    );

    // Report the NGN amount snapshotted at charge time — the orchestrator
    // checks it against Payment.amount, which is NGN.
    const amountNgn = Number(charge.metadata?.amountNgn ?? 0);

    return {
      status: charge.status === 'succeeded' ? 'success' : 'failed',
      transactionRef,
      amount: amountNgn,
      paidAt: charge.createdAt,
      orders: [],
    };
  },

  async handleWebhook(): Promise<WebhookResult> {
    // The wallet charge is synchronous — there is nothing to receive.
    return { status: 'ignored' };
  },
};
