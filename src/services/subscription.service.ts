/**
 * Subscription billing for marketplace stores.
 *
 * A store is created in DRAFT and stays invisible to buyers until its first
 * charge clears. From then on it is billed every `intervalDays` against the
 * owner's WorldStreet dollar wallet.
 *
 * State machine:
 *
 *   PENDING_PAYMENT --charge ok--> ACTIVE --period ends, charge ok--> ACTIVE
 *                                    |                    |
 *                                    |              charge fails
 *                                    |                    v
 *                                cancel()              GRACE (still visible)
 *                                    |                    |
 *                                    v            grace ends, still unpaid
 *                                CANCELLED                v
 *                                                      LAPSED (hidden)
 *
 * LAPSED is recoverable: paying reactivates the store and every listing comes
 * back, because listings are hidden rather than deleted.
 *
 * Money safety: each billing period gets exactly one `chargeRef`, derived from
 * (storeId, periodStart). The unique index on SubscriptionCharge.chargeRef and
 * the wallet's own idempotency both key off it, so a retried sweep — or two
 * server instances sweeping at once — cannot bill a vendor twice.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import { chargeWalletUsd } from './payment/providers/wallet.provider';
import { recordCredit } from './store-credit.service';
import type { Subscription, SubscriptionPlan } from '../../generated/prisma';

export const DEFAULT_PLAN_CODE = process.env.DEFAULT_PLAN_CODE || 'standard';

/** Grace windows are counted in whole days. */
function addDays(from: Date, days: number): Date {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Advances one billing period.
 *
 * Monthly plans land on the same date each month rather than every 30 days:
 * a vendor who paid on the 3rd is charged on the 3rd, and the platform bills
 * 12 times a year instead of 12.17.
 *
 * The day is clamped to the target month's length, so a store activated on
 * 31 January renews on 28 February rather than skipping to 3 March. It does
 * not then "remember" the 31st — subsequent renewals follow the clamped date,
 * which is the conservative reading and never bills early.
 */
export function addInterval(
  from: Date,
  plan: { intervalMonths: number | null; intervalDays: number },
): Date {
  if (!plan.intervalMonths) return addDays(from, plan.intervalDays);

  const out = new Date(from);
  const day = out.getUTCDate();
  out.setUTCDate(1); // avoid rolling over while changing month
  out.setUTCMonth(out.getUTCMonth() + plan.intervalMonths);

  const daysInTarget = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(day, daysInTarget));

  return out;
}

/** Deterministic per (store, period) — this is what makes billing idempotent. */
function buildChargeRef(storeId: string, periodStart: Date): string {
  return `sub_${storeId}_${periodStart.toISOString()}`;
}

export async function getActivePlans(kind: 'STORE' | 'MALL' = 'STORE'): Promise<SubscriptionPlan[]> {
  return prisma.subscriptionPlan.findMany({
    where: { isActive: true, kind },
    orderBy: [{ sortOrder: 'asc' }, { amountMinor: 'asc' }],
  });
}

export async function getPlanByCode(
  code: string,
  kind: 'STORE' | 'MALL' = 'STORE',
): Promise<SubscriptionPlan> {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { code } });
  // A plan of the wrong kind is as unavailable as one that does not exist — a
  // store cannot subscribe on a mall plan or vice versa.
  if (!plan || !plan.isActive || plan.kind !== kind) {
    throw createError(404, `Subscription plan "${code}" is not available`);
  }
  return plan;
}

/**
 * Attaches a subscription to a freshly created store. Nothing is charged here
 * — the store stays DRAFT until `chargeSubscription` succeeds.
 */
export async function createSubscription(storeId: string, planCode = DEFAULT_PLAN_CODE) {
  const plan = await getPlanByCode(planCode);

  return prisma.subscription.create({
    data: {
      storeId,
      planId: plan.id,
      status: 'PENDING_PAYMENT',
    },
  });
}

export async function getSubscriptionForStore(storeId: string) {
  return prisma.subscription.findUnique({
    where: { storeId },
    include: { plan: true, charges: { orderBy: { createdAt: 'desc' }, take: 12 } },
  });
}

export type ChargeOutcome =
  | { charged: true; alreadyPaid: boolean; periodEnd: Date }
  | { charged: false; code: string; message: string };

/**
 * Bills one period for a store and moves both the subscription and the store
 * into the resulting state.
 *
 * Safe to call repeatedly. Nothing is charged while the current period is
 * still running — a vendor who double-submits the activation form pays once,
 * not twice. Buying time ahead of the period end is a deliberate act, so it
 * requires `allowPrepay`; the renewal sweep never needs it, because it only
 * selects subscriptions whose period has already ended.
 */
export async function chargeSubscription(
  storeId: string,
  opts: { allowPrepay?: boolean } = {},
): Promise<ChargeOutcome> {
  const subscription = await prisma.subscription.findUnique({
    where: { storeId },
    include: { plan: true, store: true },
  });

  if (!subscription) throw createError(404, 'This store has no subscription');

  // Never take money for a store an admin has taken down — and never let a
  // payment overwrite that decision. The paid transaction below re-checks
  // with a status guard in case the admin acts between here and there.
  if (subscription.store.status === 'SUSPENDED' || subscription.store.status === 'BANNED') {
    throw createError(403, 'This store has been suspended. Contact support.');
  }

  // Charging a CANCELLED subscription is the resubscribe path: the vendor is
  // paying again, so auto-renewal turns back on with the new period.
  const reactivating = subscription.status === 'CANCELLED';

  const { plan, store } = subscription;
  const now = new Date();

  // Nothing is due while the paid period is still running. Without this, a
  // retried request derives a *later* period, mints a fresh chargeRef and
  // bills again — idempotency keys cannot protect against a moving period.
  if (
    !opts.allowPrepay &&
    subscription.status === 'ACTIVE' &&
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd > now
  ) {
    return { charged: true, alreadyPaid: true, periodEnd: subscription.currentPeriodEnd };
  }

  // A renewal extends from the current period end; a first (or lapsed) payment
  // starts now. Never bill from a past period end, or the vendor pays for time
  // during which the store was already hidden.
  const periodStart =
    subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
      ? subscription.currentPeriodEnd
      : now;
  const periodEnd = addInterval(periodStart, plan);
  const chargeRef = buildChargeRef(storeId, periodStart);

  const existing = await prisma.subscriptionCharge.findUnique({ where: { chargeRef } });
  if (existing?.status === 'PAID') {
    return { charged: true, alreadyPaid: true, periodEnd: existing.periodEnd };
  }

  const charge =
    existing ??
    (await prisma.subscriptionCharge.create({
      data: {
        subscriptionId: subscription.id,
        storeId,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        periodStart,
        periodEnd,
        chargeRef,
      },
    }));

  // Credit is spent before the wallet: it is money the platform already owes
  // this store, and leaving it unspent while charging the vendor again would
  // be taking payment twice for the same obligation.
  const creditMinor = Math.min(store.creditMinor, plan.amountMinor);
  const walletMinor = plan.amountMinor - creditMinor;

  if (creditMinor > 0) {
    await recordCredit({
      storeId,
      type: 'SUBSCRIPTION_DEBIT',
      amountMinor: -creditMinor,
      reference: chargeRef,
      note: `Subscription ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
    });
  }

  const result =
    walletMinor === 0
      ? ({ ok: true as const, walletRef: null, amountMinor: 0 })
      : await chargeWalletUsd({
          userId: store.ownerId,
          amountMinor: walletMinor,
          chargeRef,
          description: `WorldShop subscription — ${store.name} (${plan.name})`,
          metadata: {
            storeId,
            storeSlug: store.slug,
            planCode: plan.code,
            creditMinor,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
          },
        });

  if (!result.ok) {
    // The period was not bought, so any credit spent on it goes back. Without
    // this the vendor loses credit to a period they never received.
    if (creditMinor > 0) {
      await recordCredit({
        storeId,
        type: 'REVERSAL',
        amountMinor: creditMinor,
        reference: `${chargeRef}:reversal`,
        note: 'Wallet declined — credit returned',
      });
    }

    // A failed renewal is not a failed request — the store keeps running until
    // the grace window closes. Only a store that was never paid for stays dark.
    const wasActive = subscription.status === 'ACTIVE' || subscription.status === 'GRACE';
    const graceEndsAt = wasActive ? addDays(now, plan.graceDays) : null;

    await prisma.$transaction([
      prisma.subscriptionCharge.update({
        where: { id: charge.id },
        data: { status: 'FAILED', failureCode: result.code, failureReason: result.message },
      }),
      prisma.subscription.update({
        where: { id: subscription.id },
        data: wasActive
          ? { status: 'GRACE', graceEndsAt: subscription.graceEndsAt ?? graceEndsAt }
          : { status: 'PENDING_PAYMENT' },
      }),
      ...(wasActive && store.status === 'ACTIVE'
        ? [prisma.store.update({ where: { id: storeId }, data: { status: 'GRACE' } })]
        : []),
    ]);

    logger.warn('[Subscription] Charge failed', { storeId, chargeRef, code: result.code });
    return { charged: false, code: result.code, message: result.message };
  }

  await prisma.$transaction([
    prisma.subscriptionCharge.update({
      where: { id: charge.id },
      data: {
        status: 'PAID',
        walletRef: result.walletRef,
        creditMinor,
        walletMinor,
        chargedAt: new Date(),
      },
    }),
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        graceEndsAt: null,
        ...(reactivating ? { autoRenew: true, cancelledAt: null } : {}),
      },
    }),
    // Positive status list, not an unconditional update: a store an admin
    // suspended or banned mid-flight must stay that way even though the
    // period was paid for. (A positive `in` also sidesteps the Mongo
    // unset-field trap that `notIn` would reintroduce.)
    prisma.store.updateMany({
      where: { id: storeId, status: { in: ['DRAFT', 'ACTIVE', 'GRACE', 'EXPIRED'] } },
      data: { status: 'ACTIVE' },
    }),
  ]);

  logger.info('[Subscription] Charged', {
    storeId,
    chargeRef,
    amountMinor: plan.amountMinor,
    periodEnd: periodEnd.toISOString(),
  });

  return { charged: true, alreadyPaid: false, periodEnd };
}

/**
 * Stops auto-renewal. The store keeps the time it has already paid for —
 * cancelling is not a refund, and cutting visibility immediately would be
 * charging for a service then withdrawing it.
 */
export async function cancelSubscription(storeId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { storeId } });
  if (!subscription) throw createError(404, 'This store has no subscription');

  return prisma.subscription.update({
    where: { id: subscription.id },
    data: { autoRenew: false, cancelledAt: new Date(), status: 'CANCELLED' },
  });
}

export type SweepReport = {
  due: number;
  renewed: number;
  failed: number;
  lapsed: number;
};

/**
 * Renewal sweep — run on a timer. Three jobs, in order:
 *
 *   1. Expire stores whose grace window closed without payment.
 *   2. Charge subscriptions whose period has ended.
 *   3. Retry subscriptions already in GRACE, so a vendor who tops up mid-grace
 *      recovers without having to visit the dashboard.
 *
 * Charges run sequentially. The wallet is a shared service and this is a
 * background job — there is nothing to gain from hammering it in parallel.
 */
export async function runRenewalSweep(): Promise<SweepReport> {
  const now = new Date();
  const report: SweepReport = { due: 0, renewed: 0, failed: 0, lapsed: 0 };

  // 1. Grace expired, or a cancelled subscription's paid period ran out →
  // hide the store. Cancellation keeps the store visible only until the end
  // of what was paid for — without the CANCELLED clause here, cancelling
  // after one payment would mean visibility forever.
  const expired = await prisma.subscription.findMany({
    where: {
      OR: [
        { status: 'GRACE', graceEndsAt: { lte: now } },
        // The store-status filter keeps an already-expired cancellation from
        // re-matching (and re-counting) on every hourly sweep.
        {
          status: 'CANCELLED',
          currentPeriodEnd: { lte: now },
          store: { is: { status: { in: ['ACTIVE', 'GRACE'] } } },
        },
      ],
    },
    select: { id: true, storeId: true, status: true },
  });

  for (const sub of expired) {
    await prisma.$transaction([
      // A CANCELLED subscription stays CANCELLED (so the charge path still
      // treats a later payment as a resubscribe); only GRACE becomes LAPSED.
      ...(sub.status === 'GRACE'
        ? [prisma.subscription.update({ where: { id: sub.id }, data: { status: 'LAPSED' } })]
        : []),
      // Guarded like the paid path: never overwrite SUSPENDED/BANNED.
      prisma.store.updateMany({
        where: { id: sub.storeId, status: { in: ['DRAFT', 'ACTIVE', 'GRACE'] } },
        data: { status: 'EXPIRED' },
      }),
    ]);
    report.lapsed += 1;
  }
  if (expired.length) {
    logger.info('[Subscription] Stores expired after grace/cancellation', { count: expired.length });
  }

  // 2 + 3. Anything due for a charge.
  const due = await prisma.subscription.findMany({
    where: {
      autoRenew: true,
      OR: [
        { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
        { status: 'GRACE' },
      ],
    },
    select: { storeId: true },
  });

  report.due = due.length;

  for (const sub of due) {
    try {
      const outcome = await chargeSubscription(sub.storeId);
      if (outcome.charged) report.renewed += 1;
      else report.failed += 1;
    } catch (err) {
      report.failed += 1;
      logger.error('[Subscription] Renewal errored', {
        storeId: sub.storeId,
        error: (err as Error).message,
      });
    }
  }

  if (report.due || report.lapsed) {
    logger.info('[Subscription] Renewal sweep complete', report);
  }
  return report;
}

/** True when a store's subscription entitles it to be publicly visible. */
export function isVisibleStatus(status: string): boolean {
  return status === 'ACTIVE' || status === 'GRACE';
}

export type { Subscription };
