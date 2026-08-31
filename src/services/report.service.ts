/**
 * Reports and moderation.
 *
 * De-listing is the platform's only enforcement lever now: money moves
 * off-platform, so there is nothing to refund, claw back or arbitrate. That
 * makes this queue the whole of trust and safety, and it shapes two decisions:
 *
 *   - Reporting requires an account. Anonymous reports cannot be deduplicated
 *     or held to account, and a queue full of unattributable claims is noise.
 *   - Nothing is auto-hidden on a report count. Automatic takedown at N reports
 *     is a brigading tool — a competitor with five accounts could clear a rival
 *     off the marketplace. Counts are surfaced and ranked for a human instead.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import type { Prisma } from '../../generated/prisma';
import type { CreateReportInput, ReportAction } from '../validators/report.validator';

export const OPEN_STATUSES = ['OPEN', 'REVIEWING'] as const;

type TargetType = 'LISTING' | 'STORE' | 'MALL' | 'REVIEW';

/** Confirms the target exists and returns a label for the admin queue. */
async function resolveTarget(targetType: TargetType, targetId: string) {
  if (targetType === 'LISTING') {
    const listing = await prisma.product.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, slug: true, status: true, storeId: true },
    });
    if (!listing) throw createError(404, 'Listing not found');
    return { label: listing.name, storeId: listing.storeId, status: listing.status };
  }

  if (targetType === 'STORE') {
    const store = await prisma.store.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!store) throw createError(404, 'Store not found');
    return { label: store.name, storeId: store.id, status: store.status };
  }

  if (targetType === 'MALL') {
    const mall = await prisma.mall.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, slug: true, status: true, ownerId: true },
    });
    if (!mall) throw createError(404, 'Mall not found');
    // A mall has no storeId; ownerId carries the self-report guard instead.
    return { label: mall.name, storeId: null, ownerId: mall.ownerId, status: mall.status };
  }

  const review = await prisma.review.findUnique({
    where: { id: targetId },
    select: { id: true, comment: true, status: true, storeId: true },
  });
  if (!review) throw createError(404, 'Review not found');
  return { label: review.comment.slice(0, 80), storeId: review.storeId, status: review.status };
}

/**
 * Files a report.
 *
 * A reporter gets one open report per target: re-reporting the same listing
 * does not stack the count, because the count is the signal an admin ranks the
 * queue by and one determined person should not be able to inflate it.
 */
export async function createReport(reporterId: string, input: CreateReportInput) {
  const target = await resolveTarget(input.targetType, input.targetId);

  /**
   * Reporting your own store or listing is not moderation, it is confusion.
   *
   * Reviews are the deliberate exception. A review's target resolves to the
   * store it is *about*, so applying this guard to reviews would block a vendor
   * from flagging a fake review on their own store — the person most likely to
   * notice one, and the reason FAKE_REVIEW exists.
   */
  if (input.targetType === 'MALL') {
    if ('ownerId' in target && target.ownerId === reporterId) {
      throw createError(400, 'You cannot report your own mall');
    }
  } else if (target.storeId && input.targetType !== 'REVIEW') {
    const store = await prisma.store.findUnique({
      where: { id: target.storeId },
      select: { ownerId: true },
    });
    if (store?.ownerId === reporterId) {
      throw createError(400, `You cannot report your own ${input.targetType.toLowerCase()}`);
    }
  }

  const existing = await prisma.report.findFirst({
    where: {
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      status: { in: [...OPEN_STATUSES] },
    },
    select: { id: true },
  });
  if (existing) {
    throw createError(409, 'You have already reported this — our team is looking at it');
  }

  const report = await prisma.report.create({
    data: {
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details,
    },
  });

  // A reported review is flagged immediately: it stays visible, but both the
  // admin and the vendor can see it is disputed.
  if (input.targetType === 'REVIEW') {
    await prisma.review.updateMany({
      where: { id: input.targetId, status: 'PUBLISHED' },
      data: { status: 'FLAGGED' },
    });
  }

  logger.info('[Report] Filed', {
    reportId: report.id,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
  });

  return report;
}

export async function listReports(opts: {
  page: number;
  limit: number;
  status?: string;
  targetType?: TargetType;
  reason?: string;
}) {
  const where: Prisma.ReportWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.targetType ? { targetType: opts.targetType } : {}),
    ...(opts.reason ? { reason: opts.reason } : {}),
  };

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.report.count({ where }),
  ]);

  return { reports, total };
}

export type QueueEntry = {
  targetType: TargetType;
  targetId: string;
  label: string;
  targetStatus: string;
  reportCount: number;
  reasons: string[];
  firstReportedAt: Date;
  lastReportedAt: Date;
  reportIds: string[];
};

/**
 * The queue an admin actually works from: one row per reported *thing*, ranked
 * by how many distinct people reported it.
 *
 * A flat list of report rows buries the signal — twelve reports about one scam
 * listing look the same as twelve unrelated complaints, and the scam is what
 * needs attention first.
 *
 * Grouped in application code because the interesting fields live on three
 * different target models; the open queue is small by nature, since anything
 * left in it is unresolved work.
 */
export async function listQueue(opts: { targetType?: TargetType }): Promise<QueueEntry[]> {
  const reports = await prisma.report.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      ...(opts.targetType ? { targetType: opts.targetType } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  const grouped = new Map<string, Omit<QueueEntry, 'label' | 'targetStatus'>>();

  for (const report of reports) {
    const key = `${report.targetType}:${report.targetId}`;
    const entry = grouped.get(key);

    if (!entry) {
      grouped.set(key, {
        targetType: report.targetType as TargetType,
        targetId: report.targetId,
        reportCount: 1,
        reasons: [report.reason],
        firstReportedAt: report.createdAt,
        lastReportedAt: report.createdAt,
        reportIds: [report.id],
      });
      continue;
    }

    entry.reportCount += 1;
    if (!entry.reasons.includes(report.reason)) entry.reasons.push(report.reason);
    entry.lastReportedAt = report.createdAt;
    entry.reportIds.push(report.id);
  }

  const entries = await Promise.all(
    [...grouped.values()].map(async (entry) => {
      // A target deleted since being reported should not break the queue.
      try {
        const target = await resolveTarget(entry.targetType, entry.targetId);
        return { ...entry, label: target.label, targetStatus: String(target.status) };
      } catch {
        return { ...entry, label: '(deleted)', targetStatus: 'GONE' };
      }
    }),
  );

  return entries.sort(
    (a, b) => b.reportCount - a.reportCount || a.firstReportedAt.getTime() - b.firstReportedAt.getTime(),
  );
}

export async function getReport(reportId: string) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw createError(404, 'Report not found');

  const target = await resolveTarget(report.targetType as TargetType, report.targetId).catch(() => null);

  // Everything else outstanding about the same target, so one decision can be
  // made with the full picture rather than report-by-report.
  const siblings = await prisma.report.count({
    where: {
      targetType: report.targetType,
      targetId: report.targetId,
      status: { in: [...OPEN_STATUSES] },
      id: { not: reportId },
    },
  });

  return { report, target, otherOpenReports: siblings };
}

export async function claimReport(reportId: string, adminId: string) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw createError(404, 'Report not found');
  if (report.status !== 'OPEN') throw createError(409, `This report is already ${report.status.toLowerCase()}`);

  return prisma.report.update({
    where: { id: reportId },
    data: { status: 'REVIEWING', reviewedBy: adminId },
  });
}

/**
 * Closes every open report on a target once a decision is made about it.
 * Resolving one report and leaving eleven duplicates in the queue means the
 * next admin re-investigates work that is already done.
 */
async function closeAllForTarget(
  targetType: string,
  targetId: string,
  status: 'ACTIONED' | 'DISMISSED',
  adminId: string,
  note?: string,
) {
  const result = await prisma.report.updateMany({
    where: { targetType, targetId, status: { in: [...OPEN_STATUSES] } },
    data: { status, reviewedBy: adminId, reviewedAt: new Date(), actionNote: note },
  });
  return result.count;
}

export async function dismissReport(reportId: string, adminId: string, note?: string) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw createError(404, 'Report not found');

  const closed = await closeAllForTarget(report.targetType, report.targetId, 'DISMISSED', adminId, note);

  // A dismissed report on a review un-flags it — the dispute is settled.
  if (report.targetType === 'REVIEW') {
    await prisma.review.updateMany({
      where: { id: report.targetId, status: 'FLAGGED' },
      data: { status: 'PUBLISHED' },
    });
  }

  logger.info('[Report] Dismissed', { reportId, closed });
  return { dismissed: closed };
}

export type ActionResult = {
  action: ReportAction;
  reportsClosed: number;
  affected: { type: string; id: string; status: string };
  listingsHidden?: number;
};

/**
 * Acts on a report and closes the queue for that target.
 *
 * Suspending or banning a store also hides its listings: the store status alone
 * removes it from browse, but its individual listings are reachable by direct
 * link and would otherwise stay live.
 */
export async function actionReport(
  reportId: string,
  adminId: string,
  action: ReportAction,
  note?: string,
): Promise<ActionResult> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw createError(404, 'Report not found');

  const expected: Record<ReportAction, TargetType> = {
    REMOVE_LISTING: 'LISTING',
    SUSPEND_STORE: 'STORE',
    BAN_STORE: 'STORE',
    SUSPEND_MALL: 'MALL',
    BAN_MALL: 'MALL',
    REMOVE_REVIEW: 'REVIEW',
  };
  if (expected[action] !== report.targetType) {
    throw createError(400, `"${action}" cannot be applied to a ${report.targetType.toLowerCase()} report`);
  }

  let affected: ActionResult['affected'];
  let listingsHidden: number | undefined;

  if (action === 'REMOVE_LISTING') {
    const listing = await prisma.product.update({
      where: { id: report.targetId },
      data: { status: 'REMOVED', isActive: false },
      select: { id: true, status: true, storeId: true },
    });
    affected = { type: 'LISTING', id: listing.id, status: listing.status };

    if (listing.storeId) {
      const count = await prisma.product.count({
        where: { storeId: listing.storeId, status: 'PUBLISHED' },
      });
      await prisma.store.update({ where: { id: listing.storeId }, data: { listingCount: count } });
    }
  } else if (action === 'SUSPEND_STORE' || action === 'BAN_STORE') {
    const store = await prisma.store.update({
      where: { id: report.targetId },
      data: { status: action === 'BAN_STORE' ? 'BANNED' : 'SUSPENDED' },
      select: { id: true, status: true },
    });

    const hidden = await prisma.product.updateMany({
      where: { storeId: store.id, status: 'PUBLISHED' },
      data: { status: 'HIDDEN' },
    });
    listingsHidden = hidden.count;
    await prisma.store.update({ where: { id: store.id }, data: { listingCount: 0 } });

    affected = { type: 'STORE', id: store.id, status: store.status };
  } else if (action === 'SUSPEND_MALL' || action === 'BAN_MALL') {
    const mall = await prisma.mall.update({
      where: { id: report.targetId },
      data: { status: action === 'BAN_MALL' ? 'BANNED' : 'SUSPENDED' },
      select: { id: true, status: true },
    });

    /**
     * The mall status hides the mall page, but its substores' listings are
     * still reachable by direct link — hide them the way a store suspension
     * does. Substore Store.status is deliberately left alone: it is the
     * billing cascade's ledger (and an admin's, for individually suspended
     * substores), and flipping it here would make un-suspending the mall a
     * guessing game about what each substore was before.
     */
    const substores = await prisma.store.findMany({
      where: { mallId: mall.id, kind: 'MALL_SUBSTORE' },
      select: { id: true },
    });
    const substoreIds = substores.map((s) => s.id);

    let hiddenCount = 0;
    if (substoreIds.length) {
      const hidden = await prisma.product.updateMany({
        where: { storeId: { in: substoreIds }, status: 'PUBLISHED' },
        data: { status: 'HIDDEN' },
      });
      hiddenCount = hidden.count;
      await prisma.store.updateMany({
        where: { id: { in: substoreIds } },
        data: { listingCount: 0 },
      });
    }
    listingsHidden = hiddenCount;

    affected = { type: 'MALL', id: mall.id, status: mall.status };
  } else {
    const review = await prisma.review.update({
      where: { id: report.targetId },
      data: { status: 'REMOVED' },
      select: { id: true, status: true, productId: true, storeId: true },
    });
    affected = { type: 'REVIEW', id: review.id, status: review.status };

    // A removed review must leave both rating rollups.
    const { setReviewStatus } = await import('./marketplace.review.service');
    await setReviewStatus(review.id, 'REMOVED');
  }

  const reportsClosed = await closeAllForTarget(
    report.targetType,
    report.targetId,
    'ACTIONED',
    adminId,
    note ?? action,
  );

  logger.info('[Report] Actioned', { reportId, action, reportsClosed, listingsHidden });

  return { action, reportsClosed, affected, listingsHidden };
}

/** Counters for the admin dashboard. */
export async function reportStats() {
  const [byStatus, byTargetType, byReason, openTargets] = await Promise.all([
    prisma.report.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.report.groupBy({ by: ['targetType'], _count: { targetType: true } }),
    prisma.report.groupBy({
      by: ['reason'],
      where: { status: { in: [...OPEN_STATUSES] } },
      _count: { reason: true },
    }),
    listQueue({}),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count.status])),
    byTargetType: Object.fromEntries(byTargetType.map((r) => [r.targetType, r._count.targetType])),
    openByReason: Object.fromEntries(byReason.map((r) => [r.reason, r._count.reason])),
    openTargets: openTargets.length,
    // The ones a human should look at first.
    mostReported: openTargets.slice(0, 5).map((t) => ({
      targetType: t.targetType,
      targetId: t.targetId,
      label: t.label,
      reportCount: t.reportCount,
    })),
  };
}

/** A reporter's own history, so they can see what they filed. */
export async function listMyReports(reporterId: string, opts: { page: number; limit: number }) {
  const where: Prisma.ReportWhereInput = { reporterId };

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      // The outcome note is internal — reporters see status only.
      select: { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.report.count({ where }),
  ]);

  return { reports, total };
}
