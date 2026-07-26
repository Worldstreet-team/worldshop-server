import createError from 'http-errors';
import { globalLog as logger } from '../../../configs/loggerConfig';

/**
 * WALLET provider — pays a checkout from the buyer's central WorldStreet
 * wallet, using the wallet service's hold/capture flow.
 *
 * `initializePayment` places a HOLD (funds move from available to locked);
 * `verifyPayment` CAPTURES it. Nothing is spent until capture, so if the app
 * dies between the two, the buyer's money is never stranded: the shop's own
 * checkout sweep releases the hold when it cancels the orders, and the wallet
 * service's expiry sweep releases it regardless. An earlier version charged
 * outright, which meant a crash before verify left money taken against an
 * order that the 60-minute sweep then cancelled.
 *
 * The wallet's spend API is USD-only while the shop prices in NGN, so the
 * order total is converted at hold time using the same public rate source the
 * wallet service itself uses. The rate and both amounts are snapshotted in the
 * hold metadata; USD cents round UP so conversion never undercharges.
 */

const WALLET_API_URL = (process.env.WALLET_API_URL || '').replace(/\/+$/, '');
const WALLET_SERVICE_TOKEN = process.env.WALLET_SERVICE_TOKEN || '';

const REF_PREFIX = 'WSWALLET';

/** Must outlive the checkout reservation, so the shop's sweep gets to release
 * the hold deliberately before the wallet's expiry sweep does it for us. */
const CHECKOUT_RESERVATION_MINUTES = Number(process.env.CHECKOUT_RESERVATION_MINUTES || 60);
const HOLD_TTL_MINUTES = Math.min(
  Math.max(CHECKOUT_RESERVATION_MINUTES + 10, 5),
  10_080, // wallet's own 7-day ceiling
);

// ── FX: USD/NGN with a short TTL cache (mirrors the wallet's fx-actions) ──

const FX_TTL_MS = 120_000;
const FX_FETCH_TIMEOUT_MS = 8_000;
let fxCache: { at: number; rate: number } | null = null;

/**
 * Rate sources, tried in order. CoinGecko matches what the wallet service
 * quotes elsewhere, so it leads — but its free tier rate-limits datacenter
 * IPs, which is exactly what this server runs on. open.er-api.com is the
 * datacenter-friendly backstop (it tracks CoinGecko to within ~0.05%).
 */
const FX_SOURCES: Array<{ name: string; url: string; extract: (json: any) => unknown }> = [
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn',
    extract: (json) => json?.tether?.ngn,
  },
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/USD',
    extract: (json) => json?.rates?.NGN,
  },
];

export async function getUsdNgnRate(): Promise<number> {
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS) return fxCache.rate;

  for (const source of FX_SOURCES) {
    try {
      const res = await fetch(source.url, {
        signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn('[Wallet] FX source returned non-OK', {
          source: source.name,
          status: res.status,
        });
        continue;
      }
      const rate = source.extract(await res.json());
      if (typeof rate === 'number' && rate > 0) {
        fxCache = { at: Date.now(), rate: Math.round(rate) };
        logger.info('[Wallet] FX rate refreshed', { source: source.name, rate: fxCache.rate });
        return fxCache.rate;
      }
      logger.warn('[Wallet] FX source returned no usable rate', { source: source.name });
    } catch (err) {
      logger.warn('[Wallet] FX source unreachable', {
        source: source.name,
        error: (err as Error).message,
      });
    }
  }

  // A stale rate beats no rate — better to quote slightly off than to block
  // checkout on a third-party hiccup. Hard-fail only with nothing cached.
  if (fxCache) {
    logger.warn('[Wallet] All FX sources failed — using stale USD/NGN rate', {
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

export type WalletHold = {
  id: string;
  status: 'held' | 'captured' | 'released' | 'expired';
  amountMinor: number;
  capturedMinor: number;
  capturedAt: string | null;
  expiresAt: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type WalletResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** Calls the wallet service without throwing, so callers can branch on `code`. */
async function walletCall<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<WalletResult<T>> {
  if (!WALLET_API_URL || !WALLET_SERVICE_TOKEN) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Wallet payments are not configured' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Wallet-Service-Token': WALLET_SERVICE_TOKEN,
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let json: (Record<string, unknown> & { ok?: boolean; code?: string; error?: string }) | null;
  try {
    const res = await fetch(`${WALLET_API_URL}${path}`, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    json = (await res.json().catch(() => null)) as typeof json;
  } catch (err) {
    return { ok: false, code: 'UNREACHABLE', message: (err as Error).message };
  }

  if (!json || json.ok !== true) {
    return {
      ok: false,
      code: json?.code || 'UNKNOWN',
      message: json?.error || 'Wallet service request failed',
    };
  }
  return { ok: true, data: json as unknown as T };
}

/** Throwing wrapper for the paths where any failure must abort checkout. */
function unwrap<T>(result: WalletResult<T>, context: string): T {
  if (result.ok) return result.data;

  if (result.code === 'INSUFFICIENT_BALANCE') {
    throw createError(
      409,
      'Insufficient wallet balance for this order. Top up your dollar balance or pay by card.',
    );
  }
  logger.error('[Wallet] Service call failed', { context, code: result.code, message: result.message });
  throw createError(502, `Wallet payment failed: ${result.message}`);
}

// ── Balance ──

export type WalletCurrencyBalance = {
  availableMinor: number;
  lockedMinor: number;
  available: number;
  locked: number;
};

/**
 * The buyer's pooled USD balance from the wallet service. Throws 502/503-style
 * errors via `unwrap` — checkout needs a real answer, not a stale guess.
 */
export async function getWalletUsdBalance(userId: string): Promise<WalletCurrencyBalance> {
  const result = await walletCall<{
    balances: { USD: WalletCurrencyBalance; NGN: WalletCurrencyBalance };
  }>('GET', `/v1/wallet/${encodeURIComponent(userId)}/balances`);
  return unwrap(result, 'balances.read').balances.USD;
}

// ── Direct USD charge (subscriptions) ──

export type WalletChargeResult =
  | { ok: true; walletRef: string; amountMinor: number }
  | { ok: false; code: 'INSUFFICIENT_BALANCE' | 'UNREACHABLE' | 'NOT_CONFIGURED' | 'OTHER'; message: string };

/**
 * Charges a vendor's USD wallet outright — used for subscription billing,
 * where there is nothing to reserve and later confirm. Unlike checkout, the
 * amount is already USD, so no FX conversion is involved.
 *
 * Implemented as hold-then-capture because those are the primitives the wallet
 * service exposes to this server; the resulting spend record is identical to a
 * direct charge. The hold TTL is deliberately short — if the process dies
 * between the two calls, the wallet's expiry sweep returns the funds within
 * minutes rather than leaving them locked.
 *
 * Idempotent on `chargeRef`: the same ref replays the original hold instead of
 * locking funds twice, so a retried renewal sweep cannot double-charge.
 * Returns a result rather than throwing — a failed subscription charge is an
 * expected business outcome (insufficient balance), not an exception.
 */
export async function chargeWalletUsd(opts: {
  userId: string;
  amountMinor: number;
  chargeRef: string;
  description: string;
  metadata?: Record<string, unknown>;
}): Promise<WalletChargeResult> {
  const idempotencyKey = `worldshop:${opts.chargeRef}`;

  const held = await walletCall<{ hold: WalletHold }>(
    'POST',
    `/v1/wallet/${encodeURIComponent(opts.userId)}/holds`,
    {
      idempotencyKey,
      body: {
        amountMinor: opts.amountMinor,
        currency: 'USD',
        expiresInMinutes: 5,
        description: opts.description,
        metadata: { ...opts.metadata, chargeRef: opts.chargeRef },
      },
    },
  );

  if (!held.ok) {
    const code =
      held.code === 'INSUFFICIENT_BALANCE' || held.code === 'UNREACHABLE' || held.code === 'NOT_CONFIGURED'
        ? held.code
        : 'OTHER';
    logger.warn('[Wallet] Subscription hold failed', { chargeRef: opts.chargeRef, code: held.code });
    return { ok: false, code, message: held.message };
  }

  const hold = held.data.hold;

  // A replayed hold may already be captured — treat that as success rather
  // than capturing again.
  if (hold.status === 'captured') {
    logger.info('[Wallet] Subscription charge replayed', { chargeRef: opts.chargeRef, holdId: hold.id });
    return { ok: true, walletRef: buildRef(opts.userId, hold.id), amountMinor: hold.capturedMinor };
  }

  const captured = await walletCall<{ hold: WalletHold }>(
    'POST',
    `/v1/wallet/${encodeURIComponent(opts.userId)}/holds/${encodeURIComponent(hold.id)}/capture`,
    { body: { captureMinor: hold.amountMinor } },
  );

  if (!captured.ok) {
    // Leave the hold alone — it expires in 5 minutes and the funds return.
    logger.error('[Wallet] Subscription capture failed', {
      chargeRef: opts.chargeRef,
      holdId: hold.id,
      code: captured.code,
    });
    return { ok: false, code: 'OTHER', message: captured.message };
  }

  logger.info('[Wallet] Subscription charged', {
    chargeRef: opts.chargeRef,
    amountMinor: captured.data.hold.capturedMinor,
  });

  return {
    ok: true,
    walletRef: buildRef(opts.userId, hold.id),
    amountMinor: captured.data.hold.capturedMinor,
  };
}

// ── Composite transaction ref ──
// verifyPayment only receives the ref, but acting on a hold needs the owner's
// userId in the path — so both ride in the ref.

function buildRef(userId: string, holdId: string): string {
  return `${REF_PREFIX}:${userId}:${holdId}`;
}

