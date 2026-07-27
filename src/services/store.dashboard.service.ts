/**
 * The vendor dashboard.
 *
 * The old dashboard answered "how much did I sell". That question no longer
 * exists. The two it must answer now are:
 *
 *   1. Is my store visible, and until when?      → subscription
 *   2. Is the subscription doing anything for me? → inquiries, views, replies
 *
 * (1) is what the vendor logs in worried about. (2) is what makes them pay
 * again — a renewal notice with no evidence of value attached reads as rent.
 *
 * Everything here is already denormalised onto Store and Subscription, so this
 * is cheap: a handful of counts rather than aggregations over conversations.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import { isVisibleStatus } from './subscription.service';
import { getWalletUsdBalance } from './payment/providers/wallet.provider';

const DAY_MS = 86_400_000;

export type DashboardAlert = {
  type: 'ACTIVATE' | 'RENEWAL_DUE' | 'PAYMENT_FAILED' | 'EXPIRED' | 'UNREAD' | 'DRAFTS' | 'UNREPLIED_REVIEWS' | 'SUSPENDED';
  severity: 'info' | 'warning' | 'critical';
  message: string;
};

function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / DAY_MS);
}

export async function getDashboard(ownerId: string) {
  const store = await prisma.store.findUnique({
    where: { ownerId },
    include: { subscription: { include: { plan: true } } },
  });
  if (!store) throw createError(404, 'You do not have a store yet');

  const subscription = store.subscription;

  // The window the engagement numbers describe. While a subscription is
  // running, "this period" is the honest frame — it is literally what the
  // vendor's last $5 bought. Otherwise fall back to the last 30 days.
  const periodStart =
    subscription?.status === 'ACTIVE' && subscription.currentPeriodStart
      ? subscription.currentPeriodStart
      : new Date(Date.now() - 30 * DAY_MS);

  const [
    publishedCount,
    draftCount,
    hiddenCount,
    removedCount,
    unreadAgg,
    openThreads,
    threadsThisPeriod,
    unrepliedReviews,
    lastCharge,
    walletUsd,
  ] = await Promise.all([
    // Counted individually rather than with groupBy: an enum value that was
    // never written breaks aggregation, and a dashboard should not be the
    // thing that discovers a document predating a schema change.
    prisma.product.count({ where: { storeId: store.id, status: 'PUBLISHED' } }),
    prisma.product.count({ where: { storeId: store.id, status: 'DRAFT' } }),
    prisma.product.count({ where: { storeId: store.id, status: 'HIDDEN' } }),
    prisma.product.count({ where: { storeId: store.id, status: 'REMOVED' } }),

    prisma.conversation.aggregate({ where: { storeId: store.id }, _sum: { vendorUnread: true } }),
    prisma.conversation.count({ where: { storeId: store.id, status: 'OPEN' } }),
    prisma.conversation.count({ where: { storeId: store.id, createdAt: { gte: periodStart } } }),

    prisma.review.count({
      where: {
        storeId: store.id,
        status: { in: ['PUBLISHED', 'FLAGGED'] },
        // A never-written field is not null in MongoDB, so matching only null
        // would report zero unanswered reviews forever.
        OR: [{ vendorReply: null }, { vendorReply: { isSet: false } }],
      },
    }),

    prisma.subscriptionCharge.findFirst({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true, amountMinor: true, currency: true, creditMinor: true,
        walletMinor: true, chargedAt: true, failureCode: true, periodEnd: true,
      },
    }),

    // The wallet lives in another service, so this is the one part of the
    // dashboard that can fail on its own. It is informational — knowing the
    // balance is not worth failing the whole screen for — so a failure
    // degrades to null and the UI simply omits the figure.
    getWalletUsdBalance(store.ownerId).catch((err) => {
      logger.warn('[Dashboard] Wallet balance unavailable', {
        storeId: store.id,
        error: (err as Error).message,
      });
      return null;
    }),
  ]);

  const unread = unreadAgg._sum.vendorUnread ?? 0;
  const daysRemaining = daysUntil(subscription?.currentPeriodEnd);
  const publiclyVisible = isVisibleStatus(store.status);

  // What the next charge actually takes from the wallet. Credit is spent
  // first, so a vendor with enough credit needs no wallet balance at all —
  // telling them to top up in that case would be wrong.
  const dueMinor = subscription
    ? Math.max(subscription.plan.amountMinor - Math.min(store.creditMinor, subscription.plan.amountMinor), 0)
    : 0;

  // Ordered by what the vendor should deal with first: their store being dark
  // outranks an unread message.
  const alerts: DashboardAlert[] = [];

  if (store.status === 'BANNED' || store.status === 'SUSPENDED') {
    alerts.push({
      type: 'SUSPENDED',
      severity: 'critical',
      message:
        store.status === 'BANNED'
          ? 'This store has been banned. Contact support.'
          : 'This store is suspended and hidden from buyers. Contact support.',
    });
  } else if (subscription?.status === 'PENDING_PAYMENT') {
    alerts.push({
      type: 'ACTIVATE',
      severity: 'critical',
      message: 'Your store is not visible to buyers yet. Activate your subscription to go live.',
    });
  } else if (subscription?.status === 'GRACE') {
    alerts.push({
      type: 'PAYMENT_FAILED',
      severity: 'critical',
      message: `Your last payment failed. Top up your wallet — your store stays visible for ${daysUntil(subscription.graceEndsAt) ?? 0} more day(s).`,
    });
  } else if (subscription?.status === 'LAPSED') {
    alerts.push({
      type: 'EXPIRED',
      severity: 'critical',
      message: 'Your subscription lapsed and your listings are hidden. Pay to restore them — nothing was deleted.',
    });
  } else if (subscription?.status === 'ACTIVE' && daysRemaining !== null && daysRemaining <= 5) {
    alerts.push({
      type: 'RENEWAL_DUE',
      severity: 'warning',
      message:
        subscription.autoRenew
          ? `Renews in ${daysRemaining} day(s). Make sure your wallet has enough balance.`
          : `Auto-renewal is off — your store goes offline in ${daysRemaining} day(s).`,
    });
  }

  if (unread > 0) {
    alerts.push({
      type: 'UNREAD',
      severity: 'warning',
      message: `${unread} unread message(s). Replying quickly improves your response rate, which buyers can see.`,
    });
  }
  if (draftCount > 0) {
    alerts.push({
      type: 'DRAFTS',
      severity: 'info',
      message: `${draftCount} listing(s) still in draft and not visible to buyers.`,
    });
  }
  if (unrepliedReviews > 0) {
    alerts.push({
      type: 'UNREPLIED_REVIEWS',
      severity: 'info',
      message: `${unrepliedReviews} review(s) without a reply from you.`,
    });
  }

  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      logo: store.logo,
      status: store.status,
      verificationTier: store.verificationTier,
      publiclyVisible,
      state: store.state,
      city: store.city,
    },

    subscription: subscription
      ? {
          status: subscription.status,
          autoRenew: subscription.autoRenew,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          graceEndsAt: subscription.graceEndsAt,
          daysRemaining,
          plan: {
            code: subscription.plan.code,
            name: subscription.plan.name,
            amountMinor: subscription.plan.amountMinor,
            currency: subscription.plan.currency,
            intervalMonths: subscription.plan.intervalMonths,
            listingLimit: subscription.plan.listingLimit,
          },
          // Non-withdrawable: it exists to pay for visibility, not as savings.
          creditMinor: store.creditMinor,
          lastCharge,
        }
      : null,

    listings: {
      published: publishedCount,
      draft: draftCount,
      hidden: hiddenCount,
      removed: removedCount,
      total: publishedCount + draftCount + hiddenCount + removedCount,
      // null = unlimited
      limit: subscription?.plan.listingLimit ?? null,
    },

    // null when the wallet service could not be reached — the UI must treat
    // that as "unknown", not as "empty".
    wallet: walletUsd
      ? {
          currency: 'USD',
          availableMinor: walletUsd.availableMinor,
          lockedMinor: walletUsd.lockedMinor,
          /** What the next subscription charge will take, after store credit. */
          dueMinor,
          sufficient: walletUsd.availableMinor >= dueMinor,
        }
      : null,

    inbox: { unread, openThreads },

    engagement: {
      // The frame these numbers describe, so the UI can label it honestly
      // rather than implying "all time".
      since: periodStart,
      inquiriesThisPeriod: threadsThisPeriod,
      inquiriesAllTime: store.inquiryCount,
      views: store.viewCount,
      responseRate: store.responseRate,
      avgResponseMins: store.avgResponseMins,
    },

    reputation: {
      avgRating: store.avgRating,
      reviewCount: store.reviewCount,
      unrepliedReviews,
    },

    alerts,
  };
}
