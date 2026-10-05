/**
 * Admin billing: the subscription plans (what vendors pay) and the revenue
 * those subscriptions bring in.
 *
 * Plans used to change only by editing and re-running
 * scripts/seed-subscription-plans.ts. A price change applies to every
 * subscriber from their next renewal: charges read the plan's price when a
 * period is first billed (see chargeSubscription), so a period already
 * charged, or being retried in grace, keeps the price it started at.
 *
 * Revenue is read straight off the charge rows. SubscriptionCharge and
 * MallSubscriptionCharge record every billing period, PAID or FAILED, with
 * how it was funded, so nothing extra is tracked for this.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import { DEFAULT_PLAN_CODE } from './subscription.service';
import { DEFAULT_MALL_PLAN_CODE } from './mall.subscription.service';
import type {
  AdminPlanCreateInput,
  AdminPlanUpdateInput,
  AdminRevenueQuery,
} from '../validators/admin.billing.validator';

const DAY_MS = 86_400_000;

// ─── Plans ──────────────────────────────────────────────────────

type PlanCounts = { active: number; grace: number; pending: number; other: number };

function emptyCounts(): PlanCounts {
  return { active: 0, grace: 0, pending: 0, other: 0 };
}

function bucket(status: string): keyof PlanCounts {
  if (status === 'ACTIVE') return 'active';
  if (status === 'GRACE') return 'grace';
  if (status === 'PENDING_PAYMENT') return 'pending';
  return 'other';
}

/** Every plan, inactive ones included, with how many subscriptions use it. */
export async function listPlans() {
  const [plans, storeGroups, mallGroups] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      orderBy: [{ kind: 'desc' }, { sortOrder: 'asc' }, { amountMinor: 'asc' }],
    }),
    prisma.subscription.groupBy({ by: ['planId', 'status'], _count: { _all: true } }),
    prisma.mallSubscription.groupBy({ by: ['planId', 'status'], _count: { _all: true } }),
  ]);

  const counts = new Map<string, PlanCounts>();
  for (const g of [...storeGroups, ...mallGroups]) {
    const c = counts.get(g.planId) ?? emptyCounts();
    c[bucket(g.status)] += g._count._all;
    counts.set(g.planId, c);
  }

  return plans.map((plan) => ({
    ...plan,
    // The plan new stores and malls are put on. Deactivating it would stop
    // every new signup, so the console disables that switch.
    isDefault: plan.code === (plan.kind === 'MALL' ? DEFAULT_MALL_PLAN_CODE : DEFAULT_PLAN_CODE),
    subscribers: counts.get(plan.id) ?? emptyCounts(),
  }));
}

export async function createPlan(adminId: string, input: AdminPlanCreateInput) {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { code: input.code } });
  if (existing) throw createError(409, `A plan with the code "${input.code}" already exists`);

  const plan = await prisma.subscriptionPlan.create({
    data: {
      ...input,
      // A store plan has no substores; never let one carry a limit that
      // would read as meaning something.
      substoreLimit: input.kind === 'MALL' ? input.substoreLimit : null,
    },
  });

  logger.info('[AdminBilling] Plan created', { adminId, code: plan.code, amountMinor: plan.amountMinor });
  return plan;
}

export async function updatePlan(adminId: string, planId: string, input: AdminPlanUpdateInput) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw createError(404, 'Plan not found');

  const isDefault = plan.code === (plan.kind === 'MALL' ? DEFAULT_MALL_PLAN_CODE : DEFAULT_PLAN_CODE);
  if (isDefault && input.isActive === false) {
    throw createError(
      409,
      'This is the default plan new vendors are put on. Deactivating it would block every new signup.',
    );
  }

  const updated = await prisma.subscriptionPlan.update({
    where: { id: planId },
    data: {
      ...input,
      ...(plan.kind === 'STORE' ? { substoreLimit: null } : {}),
    },
  });

  // Prices are what vendors are billed, so every change is on the record.
  logger.info('[AdminBilling] Plan updated', {
    adminId,
    code: plan.code,
    changes: input,
    previousAmountMinor: plan.amountMinor,
  });
  return updated;
}

// ─── Revenue ────────────────────────────────────────────────────

type MonthRow = {
  month: string; // YYYY-MM, UTC
  storeMinor: number;
  mallMinor: number;
  walletMinor: number;
  creditMinor: number;
  payments: number;
};

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function startOfMonthUtc(d: Date, monthsBack = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1));
}

/** A plan's price per month, so plans on different intervals add up. */
function monthlyMinor(plan: { amountMinor: number; intervalMonths: number | null; intervalDays: number }) {
  return plan.intervalMonths
    ? plan.amountMinor / plan.intervalMonths
    : (plan.amountMinor * 30) / plan.intervalDays;
}

export async function getRevenue({ months }: AdminRevenueQuery) {
  const now = new Date();
  const windowStart = startOfMonthUtc(now, months - 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [
    storePaid,
    mallPaid,
    storeTotal,
    mallTotal,
    storeSubs,
    mallSubs,
    storeFailed30,
    mallFailed30,
    recentStore,
    recentMall,
  ] = await Promise.all([
    prisma.subscriptionCharge.findMany({
      where: { status: 'PAID', chargedAt: { gte: windowStart } },
      select: { amountMinor: true, walletMinor: true, creditMinor: true, chargedAt: true },
    }),
    prisma.mallSubscriptionCharge.findMany({
      where: { status: 'PAID', chargedAt: { gte: windowStart } },
      select: { amountMinor: true, walletMinor: true, chargedAt: true },
    }),
    prisma.subscriptionCharge.aggregate({
      where: { status: 'PAID' },
      _sum: { amountMinor: true, walletMinor: true, creditMinor: true },
      _count: { _all: true },
    }),
    prisma.mallSubscriptionCharge.aggregate({
      where: { status: 'PAID' },
      _sum: { amountMinor: true, walletMinor: true },
      _count: { _all: true },
    }),
    prisma.subscription.findMany({
      select: {
        status: true,
        autoRenew: true,
        plan: { select: { amountMinor: true, intervalMonths: true, intervalDays: true } },
      },
    }),
    prisma.mallSubscription.findMany({
      select: {
        status: true,
        autoRenew: true,
        plan: { select: { amountMinor: true, intervalMonths: true, intervalDays: true } },
      },
    }),
    prisma.subscriptionCharge.count({ where: { status: 'FAILED', updatedAt: { gte: thirtyDaysAgo } } }),
    prisma.mallSubscriptionCharge.count({ where: { status: 'FAILED', updatedAt: { gte: thirtyDaysAgo } } }),
    prisma.subscriptionCharge.findMany({
      where: { status: { in: ['PAID', 'FAILED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      include: { subscription: { select: { plan: { select: { name: true } } } } },
    }),
    prisma.mallSubscriptionCharge.findMany({
      where: { status: { in: ['PAID', 'FAILED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      include: { subscription: { select: { plan: { select: { name: true } } } } },
    }),
  ]);

  // ── Monthly series, every month present even when empty ──
  const series: MonthRow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    series.push({
      month: monthKey(startOfMonthUtc(now, i)),
      storeMinor: 0,
      mallMinor: 0,
      walletMinor: 0,
      creditMinor: 0,
      payments: 0,
    });
  }
  const byMonth = new Map(series.map((r) => [r.month, r]));
  for (const c of storePaid) {
    const row = c.chargedAt && byMonth.get(monthKey(c.chargedAt));
    if (!row) continue;
    row.storeMinor += c.amountMinor;
    row.walletMinor += c.walletMinor;
    row.creditMinor += c.creditMinor;
    row.payments += 1;
  }
  for (const c of mallPaid) {
    const row = c.chargedAt && byMonth.get(monthKey(c.chargedAt));
    if (!row) continue;
    row.mallMinor += c.amountMinor;
    row.walletMinor += c.walletMinor;
    row.payments += 1;
  }

  // ── Subscriptions by status, and the recurring revenue they carry ──
  const statusCounts = (subs: { status: string }[]) => {
    const out: Record<string, number> = {};
    for (const s of subs) out[s.status] = (out[s.status] ?? 0) + 1;
    return out;
  };
  // Only subscriptions that will be charged again count: auto-renew on, and
  // either paid up or in grace (still being retried).
  const recurring = (subs: typeof storeSubs) =>
    Math.round(
      subs
        .filter((s) => s.autoRenew && (s.status === 'ACTIVE' || s.status === 'GRACE'))
        .reduce((sum, s) => sum + monthlyMinor(s.plan), 0),
    );

  // ── Recent payments across stores and malls ──
  const storeIds = [...new Set(recentStore.map((c) => c.storeId))];
  const mallIds = [...new Set(recentMall.map((c) => c.mallId))];
  const [stores, malls] = await Promise.all([
    prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true, slug: true } }),
    prisma.mall.findMany({ where: { id: { in: mallIds } }, select: { id: true, name: true, slug: true } }),
  ]);
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const mallById = new Map(malls.map((m) => [m.id, m]));

  const recent = [
    ...recentStore.map((c) => ({
      id: c.id,
      kind: 'STORE' as const,
      name: storeById.get(c.storeId)?.name ?? 'Deleted store',
      slug: storeById.get(c.storeId)?.slug ?? null,
      plan: c.subscription.plan.name,
      amountMinor: c.amountMinor,
      walletMinor: c.walletMinor,
      creditMinor: c.creditMinor,
      status: c.status,
      failureCode: c.failureCode,
      attempts: c.attempts,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      at: c.chargedAt ?? c.updatedAt,
    })),
    ...recentMall.map((c) => ({
      id: c.id,
      kind: 'MALL' as const,
      name: mallById.get(c.mallId)?.name ?? 'Deleted mall',
      slug: mallById.get(c.mallId)?.slug ?? null,
      plan: c.subscription.plan.name,
      amountMinor: c.amountMinor,
      walletMinor: c.walletMinor,
      creditMinor: 0,
      status: c.status,
      failureCode: c.failureCode,
      attempts: c.attempts,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      at: c.chargedAt ?? c.updatedAt,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 25);

  const thisMonth = series[series.length - 1];
  const lastMonth = series.length > 1 ? series[series.length - 2] : null;

  return {
    currency: 'USD',
    totals: {
      // Everything ever billed and paid, however it was funded.
      allTimeMinor: (storeTotal._sum.amountMinor ?? 0) + (mallTotal._sum.amountMinor ?? 0),
      // The part that came out of vendor wallets: new money. The rest was
      // store credit the platform already owed.
      allTimeWalletMinor: (storeTotal._sum.walletMinor ?? 0) + (mallTotal._sum.walletMinor ?? 0),
      allTimeCreditMinor: storeTotal._sum.creditMinor ?? 0,
      allTimePayments: storeTotal._count._all + mallTotal._count._all,
      thisMonthMinor: thisMonth.storeMinor + thisMonth.mallMinor,
      lastMonthMinor: lastMonth ? lastMonth.storeMinor + lastMonth.mallMinor : 0,
      monthlyRecurringMinor: recurring(storeSubs) + recurring(mallSubs),
      failedLast30Days: storeFailed30 + mallFailed30,
    },
    subscriptions: {
      stores: statusCounts(storeSubs),
      malls: statusCounts(mallSubs),
    },
    series,
    recent,
  };
}
