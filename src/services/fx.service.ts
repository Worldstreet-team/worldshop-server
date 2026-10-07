import createError from 'http-errors';
import { globalLog as logger } from '../configs/loggerConfig';

/**
 * USD exchange rates for every currency, for showing vendors their
 * subscription price in their own money. Display only: subscriptions are
 * charged in USD from the dollar wallet, so nothing is billed at these rates.
 * Checkout's NGN conversion has its own, tighter source (wallet.provider).
 *
 * open.er-api.com publishes once a day, so an hour's cache loses nothing.
 */
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_TTL_MS = 60 * 60 * 1000;
const FX_FETCH_TIMEOUT_MS = 8_000;

export type UsdRates = { base: 'USD'; rates: Record<string, number>; updatedAt: string };

let cache: { at: number; value: UsdRates } | null = null;

export async function getUsdRates(): Promise<UsdRates> {
  if (cache && Date.now() - cache.at < FX_TTL_MS) return cache.value;

  try {
    const res = await fetch(FX_URL, { signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { rates?: Record<string, unknown>; time_last_update_utc?: string };

    const rates: Record<string, number> = {};
    for (const [code, rate] of Object.entries(json.rates ?? {})) {
      if (typeof rate === 'number' && rate > 0) rates[code] = rate;
    }
    if (!rates.NGN) throw new Error('no usable rates');

    const updatedAt = json.time_last_update_utc ? new Date(json.time_last_update_utc) : new Date();
    cache = {
      at: Date.now(),
      value: { base: 'USD', rates, updatedAt: (isNaN(updatedAt.getTime()) ? new Date() : updatedAt).toISOString() },
    };
    return cache.value;
  } catch (err) {
    // A day-old rate is fine for a price label; only fail with nothing at all.
    if (cache) {
      logger.warn('[FX] Rate refresh failed, serving cached rates', { error: (err as Error).message });
      return cache.value;
    }
    logger.warn('[FX] Rate fetch failed', { error: (err as Error).message });
    throw createError(503, 'Exchange rates are unavailable right now');
  }
}
