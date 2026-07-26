import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as chat from '../../services/chat.service';
import * as reviews from '../../services/marketplace.review.service';
import * as reports from '../../services/report.service';

const PREFIX = 'reptest-';
const SLUG = 'reptest';
const ADMIN = `${PREFIX}admin`;

let categoryId: string;

async function cleanup() {
  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length) {
    const products = await prisma.product.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true },
    });
    const reviewRows = await prisma.review.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true },
    });
    const convos = await prisma.conversation.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true },
    });

    const targetIds = [
      ...storeIds,
      ...products.map((p) => p.id),
      ...reviewRows.map((r) => r.id),
    ];
    if (targetIds.length) {
      await prisma.report.deleteMany({ where: { targetId: { in: targetIds } } });
    }
    if (convos.length) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
      await prisma.conversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } });
    }
    await prisma.review.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }
  await prisma.report.deleteMany({ where: { reporterId: { startsWith: PREFIX } } });
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

async function makeStore(name: string) {
  const ownerId = `${PREFIX}vendor-${name}`;
  await createTestUser({ userId: ownerId });
  return prisma.store.create({
    data: { ownerId, name: `${name} Store`, slug: `${SLUG}-${name}`, state: 'Lagos', status: 'ACTIVE' },
  });
}

async function makeListing(storeId: string) {
  return prisma.product.create({
    data: {
      name: `${SLUG} listing ${Math.random().toString(36).slice(2, 8)}`,
      slug: `${SLUG}-l-${Math.random().toString(36).slice(2, 10)}`,
      description: 'A listing used for report tests',
      basePrice: 7000,
      categoryId,
      storeId,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
}

async function makeUser(name: string) {
  const id = `${PREFIX}user-${name}`;
  await createTestUser({ userId: id, firstName: 'Rep', lastName: 'Orter' });
  return id;
}

describe('reports and moderation', () => {
  beforeAll(async () => {
    await cleanup();
    const category = await prisma.category.upsert({
      where: { slug: `${SLUG}-cat` },
      create: { name: 'Reptest Category', slug: `${SLUG}-cat` },
      update: {},
    });
    categoryId = category.id;
    await createTestUser({ userId: ADMIN });
  });

  afterEach(cleanup);
  afterAll(async () => {
    await prisma.category.deleteMany({ where: { slug: `${SLUG}-cat` } });
    await prisma.userProfile.deleteMany({ where: { userId: ADMIN } });
  });

  it('files a report against a listing', async () => {
    const store = await makeStore('file');
    const listing = await makeListing(store.id);
    const reporter = await makeUser('file');

    const report = await reports.createReport(reporter, {
      targetType: 'LISTING',
      targetId: listing.id,
      reason: 'SCAM',
      details: 'Asking for transfer before showing the item',
    });

    expect(report.status).toBe('OPEN');
  });

  it('rejects a report against something that does not exist', async () => {
    const reporter = await makeUser('missing');
    await expect(
      reports.createReport(reporter, {
        targetType: 'LISTING',
        targetId: '0'.repeat(24),
        reason: 'SCAM',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('stops a vendor reporting their own store', async () => {
    const store = await makeStore('self');
    await expect(
      reports.createReport(store.ownerId, {
        targetType: 'STORE',
        targetId: store.id,
        reason: 'OTHER',
      }),
    ).rejects.toThrow(/your own store/i);
  });

  it('lets a vendor report a fake review on their own store', async () => {
    const store = await makeStore('ownreview');
    const listing = await makeListing(store.id);
    const buyer = await makeUser('ownreview');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'A question here' });
    const review = await reviews.createReview(buyer, listing.id, {
      rating: 1, comment: 'A review the seller believes is fake.',
    });

    // The review's target resolves to the store it is about, so a naive
    // self-report guard would block the one person most likely to spot it.
    const report = await reports.createReport(store.ownerId, {
      targetType: 'REVIEW',
      targetId: review.id,
      reason: 'FAKE_REVIEW',
    });
    expect(report.status).toBe('OPEN');
  });

  it('still blocks reporting your own listing', async () => {
    const store = await makeStore('ownlisting');
    const listing = await makeListing(store.id);

    await expect(
      reports.createReport(store.ownerId, {
        targetType: 'LISTING',
        targetId: listing.id,
        reason: 'SCAM',
      }),
    ).rejects.toThrow(/your own listing/i);
  });

  it('allows one open report per person per target', async () => {
    const store = await makeStore('dedupe');
    const listing = await makeListing(store.id);
    const reporter = await makeUser('dedupe');

    await reports.createReport(reporter, { targetType: 'LISTING', targetId: listing.id, reason: 'SCAM' });

    // The count is what an admin ranks the queue by; one person must not be
    // able to inflate it.
    await expect(
      reports.createReport(reporter, { targetType: 'LISTING', targetId: listing.id, reason: 'MISLEADING' }),
    ).rejects.toThrow(/already reported/i);
  });

  it('ranks the queue by how many distinct people reported a target', async () => {
    const store = await makeStore('rank');
    const scam = await makeListing(store.id);
    const minor = await makeListing(store.id);

    for (const n of ['a', 'b', 'c']) {
      const reporter = await makeUser(`rank-${n}`);
      await reports.createReport(reporter, { targetType: 'LISTING', targetId: scam.id, reason: 'SCAM' });
    }
    const single = await makeUser('rank-single');
    await reports.createReport(single, {
      targetType: 'LISTING',
      targetId: minor.id,
      reason: 'MISCATEGORISED',
    });

    const queue = await reports.listQueue({});
    const [first, second] = queue;

    // Three reports on one listing must not read the same as three unrelated ones.
    expect(first.targetId).toBe(scam.id);
    expect(first.reportCount).toBe(3);
    expect(second.reportCount).toBe(1);
    expect(queue).toHaveLength(2);
  });

  it('collects distinct reasons per target', async () => {
    const store = await makeStore('reasons');
    const listing = await makeListing(store.id);

    for (const [i, reason] of (['SCAM', 'MISLEADING', 'SCAM'] as const).entries()) {
      const reporter = await makeUser(`reason-${i}`);
      await reports.createReport(reporter, { targetType: 'LISTING', targetId: listing.id, reason });
    }

    const [entry] = await reports.listQueue({});
    expect(entry.reportCount).toBe(3);
    expect(entry.reasons.sort()).toEqual(['MISLEADING', 'SCAM']);
  });

  it('removes a listing and closes every report on it at once', async () => {
    const store = await makeStore('remove');
    const listing = await makeListing(store.id);

    const ids: string[] = [];
    for (const n of ['a', 'b']) {
      const reporter = await makeUser(`remove-${n}`);
      const r = await reports.createReport(reporter, {
        targetType: 'LISTING',
        targetId: listing.id,
        reason: 'PROHIBITED',
      });
      ids.push(r.id);
    }

    const result = await reports.actionReport(ids[0], ADMIN, 'REMOVE_LISTING', 'Banned goods');

    // One decision must clear the queue, not leave duplicates for the next admin.
    expect(result.reportsClosed).toBe(2);
    expect((await prisma.product.findUnique({ where: { id: listing.id } }))?.status).toBe('REMOVED');
    expect(await reports.listQueue({})).toHaveLength(0);

    const other = await prisma.report.findUnique({ where: { id: ids[1] } });
    expect(other).toMatchObject({ status: 'ACTIONED', reviewedBy: ADMIN });
  });

  it('hides a suspended store’s listings, not just the store', async () => {
    const store = await makeStore('suspend');
    await makeListing(store.id);
    await makeListing(store.id);
    const reporter = await makeUser('suspend');

    const report = await reports.createReport(reporter, {
      targetType: 'STORE',
      targetId: store.id,
      reason: 'SCAM',
    });

    const result = await reports.actionReport(report.id, ADMIN, 'SUSPEND_STORE', 'Multiple scam reports');

    // Store status alone removes it from browse, but listings stay reachable
    // by direct link.
    expect(result.listingsHidden).toBe(2);
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.status).toBe('SUSPENDED');
    const stillPublished = await prisma.product.count({
      where: { storeId: store.id, status: 'PUBLISHED' },
    });
    expect(stillPublished).toBe(0);
  });

  it('bans a store when asked', async () => {
    const store = await makeStore('ban');
    const reporter = await makeUser('ban');
    const report = await reports.createReport(reporter, {
      targetType: 'STORE',
      targetId: store.id,
      reason: 'SCAM',
    });

    await reports.actionReport(report.id, ADMIN, 'BAN_STORE');
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.status).toBe('BANNED');
  });

  it('refuses an action that does not match the target type', async () => {
    const store = await makeStore('mismatch');
    const listing = await makeListing(store.id);
    const reporter = await makeUser('mismatch');
    const report = await reports.createReport(reporter, {
      targetType: 'LISTING',
      targetId: listing.id,
      reason: 'SCAM',
    });

    await expect(reports.actionReport(report.id, ADMIN, 'BAN_STORE')).rejects.toThrow(
      /cannot be applied to a listing report/i,
    );
  });

  it('flags a reported review immediately but keeps it visible', async () => {
    const store = await makeStore('flagreview');
    const listing = await makeListing(store.id);
    const buyer = await makeUser('flagreview');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'A question here' });
    const review = await reviews.createReview(buyer, listing.id, {
      rating: 1,
      comment: 'This review is itself disputed by the seller.',
    });

    const reporter = await makeUser('flagreporter');
    await reports.createReport(reporter, {
      targetType: 'REVIEW',
      targetId: review.id,
      reason: 'FAKE_REVIEW',
    });

    // Flagged, not hidden — the dispute is visible to everyone while it is open.
    expect((await prisma.review.findUnique({ where: { id: review.id } }))?.status).toBe('FLAGGED');
    const listed = await reviews.listProductReviews(listing.id, { page: 1, limit: 20 });
    expect(listed.total).toBe(1);
  });

  it('removing a review takes it out of the rating rollups', async () => {
    const store = await makeStore('removereview');
    const listing = await makeListing(store.id);
    const buyer = await makeUser('removereview');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'A question here' });
    const review = await reviews.createReview(buyer, listing.id, {
      rating: 1,
      comment: 'Abusive content that should not stand.',
    });

    const reporter = await makeUser('removereviewrep');
    const report = await reports.createReport(reporter, {
      targetType: 'REVIEW',
      targetId: review.id,
      reason: 'OFFENSIVE',
    });

    await reports.actionReport(report.id, ADMIN, 'REMOVE_REVIEW', 'Abusive');

    expect((await prisma.review.findUnique({ where: { id: review.id } }))?.status).toBe('REMOVED');
    const s = await prisma.store.findUnique({ where: { id: store.id } });
    expect(s).toMatchObject({ avgRating: 0, reviewCount: 0 });
  });

  it('un-flags a review when the report is dismissed', async () => {
    const store = await makeStore('dismissreview');
    const listing = await makeListing(store.id);
    const buyer = await makeUser('dismissreview');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'A question here' });
    const review = await reviews.createReview(buyer, listing.id, {
      rating: 2,
      comment: 'A fair but unflattering review of this seller.',
    });

    const reporter = await makeUser('dismissreporter');
    const report = await reports.createReport(reporter, {
      targetType: 'REVIEW',
      targetId: review.id,
      reason: 'FAKE_REVIEW',
    });

    const result = await reports.dismissReport(report.id, ADMIN, 'Review looks genuine');

    expect(result.dismissed).toBe(1);
    // The dispute is settled, so the flag comes off.
    expect((await prisma.review.findUnique({ where: { id: review.id } }))?.status).toBe('PUBLISHED');
  });

  it('claims a report so two admins do not duplicate work', async () => {
    const store = await makeStore('claim');
    const listing = await makeListing(store.id);
    const reporter = await makeUser('claim');
    const report = await reports.createReport(reporter, {
      targetType: 'LISTING',
      targetId: listing.id,
      reason: 'SCAM',
    });

    const claimed = await reports.claimReport(report.id, ADMIN);
    expect(claimed).toMatchObject({ status: 'REVIEWING', reviewedBy: ADMIN });

    await expect(reports.claimReport(report.id, ADMIN)).rejects.toThrow(/already reviewing/i);
  });

  it('shows the target and sibling reports on a single report', async () => {
    const store = await makeStore('detail');
    const listing = await makeListing(store.id);

    const ids: string[] = [];
    for (const n of ['a', 'b', 'c']) {
      const reporter = await makeUser(`detail-${n}`);
      const r = await reports.createReport(reporter, {
        targetType: 'LISTING',
        targetId: listing.id,
        reason: 'SCAM',
      });
      ids.push(r.id);
    }

    const detail = await reports.getReport(ids[0]);
    expect(detail.target?.label).toBe(listing.name);
    expect(detail.otherOpenReports).toBe(2);
  });

  it('survives a target deleted after being reported', async () => {
    const store = await makeStore('gone');
    const listing = await makeListing(store.id);
    const reporter = await makeUser('gone');
    await reports.createReport(reporter, {
      targetType: 'LISTING',
      targetId: listing.id,
      reason: 'DUPLICATE',
    });

    await prisma.product.delete({ where: { id: listing.id } });

    const queue = await reports.listQueue({});
    expect(queue[0]).toMatchObject({ label: '(deleted)', targetStatus: 'GONE' });
  });

  it('reports stats with the most-reported targets first', async () => {
    const store = await makeStore('stats');
    const listing = await makeListing(store.id);
    for (const n of ['a', 'b']) {
      const reporter = await makeUser(`stats-${n}`);
      await reports.createReport(reporter, { targetType: 'LISTING', targetId: listing.id, reason: 'SCAM' });
    }

    const stats = await reports.reportStats();
    expect(stats.byStatus.OPEN).toBeGreaterThanOrEqual(2);
    expect(stats.openByReason.SCAM).toBeGreaterThanOrEqual(2);
    expect(stats.mostReported[0]).toMatchObject({ targetId: listing.id, reportCount: 2 });
  });

  it('lets a reporter see their own history without internal notes', async () => {
    const store = await makeStore('history');
    const listing = await makeListing(store.id);
    const reporter = await makeUser('history');
    const report = await reports.createReport(reporter, {
      targetType: 'LISTING',
      targetId: listing.id,
      reason: 'SCAM',
    });
    await reports.actionReport(report.id, ADMIN, 'REMOVE_LISTING', 'Internal: confirmed scammer');

    const { reports: mine } = await reports.listMyReports(reporter, { page: 1, limit: 20 });
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe('ACTIONED');
    expect(mine[0]).not.toHaveProperty('actionNote');
  });
});
