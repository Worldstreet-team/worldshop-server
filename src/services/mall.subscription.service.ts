/**
 * Subscription billing for malls.
 *
 * Deliberately a parallel of subscription.service.ts rather than a
 * generalisation of it: the store path is money-critical and battle-tested,
 * and on MongoDB a unique index over an optional Subscription.storeId is not
 * sparse, so the two products cannot share one table safely. The state
 * machine, period arithmetic (`addInterval`) and wallet provider are shared.
 *
 * The one structural difference: a mall's substores have no subscriptions of
 * their own. Every status transition here cascades to them in the same
 * transaction — paid flips them ACTIVE, a failed renewal flips them GRACE,
 * an expired grace window flips them EXPIRED. Only ACTIVE/GRACE/EXPIRED are
 * ever touched, so an admin SUSPENDED/BANNED substore (or a DRAFT one) is
 * never resurrected by a mall payment.
 *
 * Malls are wallet-only at launch — there is no mall credit ledger. ChargeRefs
 * are prefixed `mallsub_` so they can never collide with store refs.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import { chargeWalletUsd } from './payment/providers/wallet.provider';
import { addInterval, getPlanByCode } from './subscription.service';
import type { Prisma } from '../../generated/prisma';

export const DEFAULT_MALL_PLAN_CODE = process.env.DEFAULT_MALL_PLAN_CODE || 'mall-standard';

function addDays(from: Date, days: number): Date {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Deterministic per (mall, period) — this is what makes billing idempotent. */
function buildChargeRef(mallId: string, periodStart: Date): string {
  return `mallsub_${mallId}_${periodStart.toISOString()}`;
}

/**
 * Substores whose visibility a mall transition may change. DRAFT, SUSPENDED
 * and BANNED stay whatever an admin or the owner made them.
 */
function cascadeSubstores(
  mallId: string,
  from: ('ACTIVE' | 'GRACE' | 'EXPIRED')[],
  to: 'ACTIVE' | 'GRACE' | 'EXPIRED',
): Prisma.PrismaPromise<Prisma.BatchPayload> {
  return prisma.store.updateMany({
    where: { mallId, kind: 'MALL_SUBSTORE', status: { in: from } },
    data: { status: to },
  });
}

/**
 * Attaches a subscription to a freshly created mall. Nothing is charged here
 * — the mall stays DRAFT until `chargeMallSubscription` succeeds.
 */
export async function createMallSubscription(mallId: string, planCode = DEFAULT_MALL_PLAN_CODE) {
  const plan = await getPlanByCode(planCode, 'MALL');

  return prisma.mallSubscription.create({
    data: {
      mallId,
      planId: plan.id,
      status: 'PENDING_PAYMENT',
    },
  });
}

export async function getSubscriptionForMall(mallId: string) {
  return prisma.mallSubscription.findUnique({
    where: { mallId },
    include: { plan: true, charges: { orderBy: { createdAt: 'desc' }, take: 12 } },
  });
}

export type MallChargeOutcome =
  | { charged: true; alreadyPaid: boolean; periodEnd: Date }
  | { charged: false; code: string; message: string };

/**
 * Bills one period for a mall and moves the subscription, the mall and its
 * substores into the resulting state. Safe to call repeatedly — nothing is
 * charged while the current period is still running unless `allowPrepay`.
 */
export async function chargeMallSubscription(
  mallId: string,
  opts: { allowPrepay?: boolean } = {},
): Promise<MallChargeOutcome> {
  const subscription = await prisma.mallSubscription.findUnique({
    where: { mallId },
    include: { plan: true, mall: true },
  });

  if (!subscription) throw createError(404, 'This mall has no subscription');

  // Never take money for a mall an admin has taken down — and never let a
  // payment overwrite that decision. The paid transaction below re-checks
  // with a status guard in case the admin acts between here and there.
  if (subscription.mall.status === 'SUSPENDED' || subscription.mall.status === 'BANNED') {
    throw createError(403, 'This mall has been suspended. Contact support.');
  }

  // Charging a CANCELLED subscription is the resubscribe path: the owner is
  // paying again, so auto-renewal turns back on with the new period.
  const reactivating = subscription.status === 'CANCELLED';

  const { plan, mall } = subscription;
  const now = new Date();

  // Nothing is due while the paid period is still running (see the store
  // version for why idempotency keys alone cannot protect a moving period).
  if (
    !opts.allowPrepay &&
    subscription.status === 'ACTIVE' &&
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd > now
  ) {
    return { charged: true, alreadyPaid: true, periodEnd: subscription.currentPeriodEnd };
  }

  // A renewal extends from the current period end; a first (or lapsed) payment
  // starts now.
  const periodStart =
    subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
      ? subscription.currentPeriodEnd
      : now;
  const periodEnd = addInterval(periodStart, plan);
  const chargeRef = buildChargeRef(mallId, periodStart);

  const existing = await prisma.mallSubscriptionCharge.findUnique({ where: { chargeRef } });
  if (existing?.status === 'PAID') {
    return { charged: true, alreadyPaid: true, periodEnd: existing.periodEnd };
  }

  const charge =
    existing ??
    (await prisma.mallSubscriptionCharge.create({
      data: {
        subscriptionId: subscription.id,
        mallId,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        periodStart,
        periodEnd,
        chargeRef,
      },
    }));

  const result = await chargeWalletUsd({
    userId: mall.ownerId,
    amountMinor: plan.amountMinor,
    chargeRef,
    description: `WorldShop mall subscription — ${mall.name} (${plan.name})`,
    metadata: {
      mallId,
      mallSlug: mall.slug,
      planCode: plan.code,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    },
  });

  if (!result.ok) {
    // A failed renewal is not a failed request — the mall and its substores
    // keep running until the grace window closes. Only a mall that was never
    // paid for stays dark.
    const wasActive = subscription.status === 'ACTIVE' || subscription.status === 'GRACE';
    const graceEndsAt = wasActive ? addDays(now, plan.graceDays) : null;

    await prisma.$transaction([
      prisma.mallSubscriptionCharge.update({
        where: { id: charge.id },
        data: { status: 'FAILED', failureCode: result.code, failureReason: result.message },
      }),
      prisma.mallSubscription.update({
        where: { id: subscription.id },
        data: wasActive
          ? { status: 'GRACE', graceEndsAt: subscription.graceEndsAt ?? graceEndsAt }
          : { status: 'PENDING_PAYMENT' },
      }),
      ...(wasActive && mall.status === 'ACTIVE'
        ? [
            prisma.mall.update({ where: { id: mallId }, data: { status: 'GRACE' } }),
            cascadeSubstores(mallId, ['ACTIVE'], 'GRACE'),
          ]
        : []),
    ]);

    logger.warn('[MallSubscription] Charge failed', { mallId, chargeRef, code: result.code });
    return { charged: false, code: result.code, message: result.message };
  }

  await prisma.$transaction([
    prisma.mallSubscriptionCharge.update({
      where: { id: charge.id },
      data: {
        status: 'PAID',
        walletRef: result.walletRef,
        walletMinor: plan.amountMinor,
        chargedAt: new Date(),
      },
    }),
    prisma.mallSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        graceEndsAt: null,
        ...(reactivating ? { autoRenew: true, cancelledAt: null } : {}),
      },
    }),
    // Positive status list, not an unconditional update: a mall an admin
    // suspended or banned mid-flight must stay that way even though the
    // period was paid for. (A positive `in` also sidesteps the Mongo
    // unset-field trap that `notIn` would reintroduce.)
    prisma.mall.updateMany({
      where: { id: mallId, status: { in: ['DRAFT', 'ACTIVE', 'GRACE', 'EXPIRED'] } },
      data: { status: 'ACTIVE' },
    }),
    cascadeSubstores(mallId, ['GRACE', 'EXPIRED'], 'ACTIVE'),
  ]);

  logger.info('[MallSubscription] Charged', {
    mallId,
    chargeRef,
    amountMinor: plan.amountMinor,
    periodEnd: periodEnd.toISOString(),
  });

  return { charged: true, alreadyPaid: false, periodEnd };
}

/**
 * Stops auto-renewal. The mall keeps the time it has already paid for —
 * cancelling is not a refund.
 */
export async function cancelMallSubscription(mallId: string) {
  const subscription = await prisma.mallSubscription.findUnique({ where: { mallId } });
  if (!subscription) throw createError(404, 'This mall has no subscription');

  return prisma.mallSubscription.update({
    where: { id: subscription.id },
    data: { autoRenew: false, cancelledAt: new Date(), status: 'CANCELLED' },
  });
}

export type MallSweepReport = {
  due: number;
  renewed: number;
  failed: number;
  lapsed: number;
};

/**
 * Mall renewal sweep — run on the same timer as the store sweep. Same three
 * jobs: expire malls whose grace closed, charge due subscriptions, retry
 * malls in GRACE.
 */
export async function runMallRenewalSweep(): Promise<MallSweepReport> {
  const now = new Date();
  const report: MallSweepReport = { due: 0, renewed: 0, failed: 0, lapsed: 0 };

  // 1. Grace expired, or a cancelled subscription's paid period ran out →
  // hide the mall and its substores. Cancellation keeps the mall visible
  // only until the end of what was paid for — without the CANCELLED clause
  // here, cancelling after one payment would mean visibility forever.
  const expired = await prisma.mallSubscription.findMany({
    where: {
      OR: [
        { status: 'GRACE', graceEndsAt: { lte: now } },
        // The mall-status filter keeps an already-expired cancellation from
        // re-matching (and re-counting) on every hourly sweep.
        {
          status: 'CANCELLED',
          currentPeriodEnd: { lte: now },
          mall: { is: { status: { in: ['ACTIVE', 'GRACE'] } } },
        },
      ],
    },
    select: { id: true, mallId: true, status: true },
  });

  for (const sub of expired) {
    await prisma.$transaction([
      // A CANCELLED subscription stays CANCELLED (so the charge path still
      // treats a later payment as a resubscribe); only GRACE becomes LAPSED.
      ...(sub.status === 'GRACE'
        ? [prisma.mallSubscription.update({ where: { id: sub.id }, data: { status: 'LAPSED' } })]
        : []),
      // Guarded like the paid path: never overwrite SUSPENDED/BANNED.
      prisma.mall.updateMany({
        where: { id: sub.mallId, status: { in: ['DRAFT', 'ACTIVE', 'GRACE'] } },
        data: { status: 'EXPIRED' },
      }),
      cascadeSubstores(sub.mallId, ['ACTIVE', 'GRACE'], 'EXPIRED'),
    ]);
    report.lapsed += 1;
  }
  if (expired.length) {
    logger.info('[MallSubscription] Malls expired after grace/cancellation', { count: expired.length });
  }

  // 2 + 3. Anything due for a charge.
  const due = await prisma.mallSubscription.findMany({
    where: {
      autoRenew: true,
      OR: [
        { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
        { status: 'GRACE' },
      ],
    },
    select: { mallId: true },
  });

  report.due = due.length;

  for (const sub of due) {
    try {
      const outcome = await chargeMallSubscription(sub.mallId);
      if (outcome.charged) report.renewed += 1;
      else report.failed += 1;
    } catch (err) {
      report.failed += 1;
      logger.error('[MallSubscription] Renewal errored', {
        mallId: sub.mallId,
        error: (err as Error).message,
      });
    }
  }

  if (report.due || report.lapsed) {
    logger.info('[MallSubscription] Renewal sweep complete', report);
  }
  return report;
}
