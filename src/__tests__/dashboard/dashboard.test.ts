import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';

const chargeWalletUsd = vi.hoisted(() => vi.fn());
const getWalletUsdBalance = vi.hoisted(() =>
  vi.fn(async () => ({ availableMinor: 5_00, lockedMinor: 0, available: 5, locked: 0 })),
);
vi.mock('../../services/payment/providers/wallet.provider', () => ({
  chargeWalletUsd,
  getWalletUsdBalance,
}));

import * as chat from '../../services/chat.service';
import * as reviews from '../../services/marketplace.review.service';
import * as subscriptions from '../../services/subscription.service';
import { getDashboard } from '../../services/store.dashboard.service';

const PREFIX = 'dashtest-';
const SLUG = 'dashtest';
const PLAN_CODE = 'dashtest-standard';

let categoryId: string;

async function cleanup() {
  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = stores.map((s) => s.id);

  if (ids.length) {
    const convos = await prisma.conversation.findMany({
      where: { storeId: { in: ids } },
      select: { id: true },
    });
    if (convos.length) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
      await prisma.conversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } });
    }
    await prisma.review.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.subscriptionCharge.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.subscription.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.product.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.store.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

async function makeStore(name: string) {
  const ownerId = `${PREFIX}vendor-${name}`;
  await createTestUser({ userId: ownerId });
  const store = await prisma.store.create({
    data: { ownerId, name: `${name} Store`, slug: `${SLUG}-${name}`, state: 'Lagos', status: 'DRAFT' },
  });
  await subscriptions.createSubscription(store.id, PLAN_CODE);
  return store;
}

async function makeListing(storeId: string, status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' = 'PUBLISHED') {
  return prisma.product.create({
    data: {
      name: `${SLUG} listing ${Math.random().toString(36).slice(2, 8)}`,
      slug: `${SLUG}-l-${Math.random().toString(36).slice(2, 10)}`,
      description: 'A listing used for dashboard tests',
      basePrice: 4000,
      categoryId,
      storeId,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    },
  });
}

async function makeBuyer(name: string) {
  const id = `${PREFIX}buyer-${name}`;
  await createTestUser({ userId: id, firstName: 'Dash', lastName: 'Buyer' });
  return id;
}

describe('vendor dashboard', () => {
  beforeAll(async () => {
    await cleanup();
    const category = await prisma.category.upsert({
      where: { slug: `${SLUG}-cat` },
      create: { name: 'Dashtest Category', slug: `${SLUG}-cat` },
      update: {},
    });
    categoryId = category.id;
    await prisma.subscriptionPlan.upsert({
      where: { code: PLAN_CODE },
      create: {
        code: PLAN_CODE, name: 'Dash Standard', amountMinor: 500,
        intervalMonths: 1, intervalDays: 30, graceDays: 7, perks: [],
      },
      update: { isActive: true },
    });
    chargeWalletUsd.mockResolvedValue({ ok: true, walletRef: 'WSWALLET:u:h', amountMinor: 500 });
  });

  afterEach(cleanup);
  afterAll(async () => {
    await prisma.subscriptionPlan.deleteMany({ where: { code: PLAN_CODE } });
    await prisma.category.deleteMany({ where: { slug: `${SLUG}-cat` } });
  });

  it('tells an unpaid vendor their store is not visible, first', async () => {
    const store = await makeStore('unpaid');
    const dash = await getDashboard(store.ownerId);

    expect(dash.store.publiclyVisible).toBe(false);
    expect(dash.subscription?.status).toBe('PENDING_PAYMENT');
    // The store being dark outranks everything else on the page.
    expect(dash.alerts[0]).toMatchObject({ type: 'ACTIVATE', severity: 'critical' });
  });

  it('reports days remaining once active', async () => {
    const store = await makeStore('active');
    await subscriptions.chargeSubscription(store.id);

    const dash = await getDashboard(store.ownerId);

    expect(dash.store.publiclyVisible).toBe(true);
    expect(dash.subscription?.status).toBe('ACTIVE');
    expect(dash.subscription?.daysRemaining).toBeGreaterThan(25);
    expect(dash.subscription?.plan.amountMinor).toBe(500);
    expect(dash.subscription?.lastCharge).toMatchObject({ status: 'PAID', walletMinor: 500 });
    expect(dash.alerts.find((a) => a.type === 'ACTIVATE')).toBeUndefined();
  });

  it('warns when a renewal is close', async () => {
    const store = await makeStore('renewsoon');
    await subscriptions.chargeSubscription(store.id);
    await prisma.subscription.update({
      where: { storeId: store.id },
      data: { currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000) },
    });

    const dash = await getDashboard(store.ownerId);
    expect(dash.alerts.find((a) => a.type === 'RENEWAL_DUE')).toMatchObject({ severity: 'warning' });
  });

  it('says listings are hidden but not deleted when lapsed', async () => {
    const store = await makeStore('lapsed');
    await prisma.subscription.update({ where: { storeId: store.id }, data: { status: 'LAPSED' } });
    await prisma.store.update({ where: { id: store.id }, data: { status: 'EXPIRED' } });

    const dash = await getDashboard(store.ownerId);
    const alert = dash.alerts.find((a) => a.type === 'EXPIRED');

    expect(dash.store.publiclyVisible).toBe(false);
    expect(alert?.message).toMatch(/nothing was deleted/i);
  });

  it('counts listings by status', async () => {
    const store = await makeStore('counts');
    await makeListing(store.id, 'PUBLISHED');
    await makeListing(store.id, 'PUBLISHED');
    await makeListing(store.id, 'DRAFT');
    await makeListing(store.id, 'HIDDEN');

    const dash = await getDashboard(store.ownerId);

    expect(dash.listings).toMatchObject({ published: 2, draft: 1, hidden: 1, total: 4 });
    expect(dash.listings.limit).toBeNull(); // unlimited on this plan
    expect(dash.alerts.find((a) => a.type === 'DRAFTS')?.message).toMatch(/1 listing/);
  });

  it('surfaces unread messages and inquiry counts', async () => {
    const store = await makeStore('inbox');
    await prisma.store.update({ where: { id: store.id }, data: { status: 'ACTIVE' } });
    const listing = await makeListing(store.id);

    const buyer1 = await makeBuyer('one');
    const buyer2 = await makeBuyer('two');
    await chat.startConversation(buyer1, { listingId: listing.id, message: 'First question here' });
    await chat.startConversation(buyer2, { listingId: listing.id, message: 'Second question here' });

    const dash = await getDashboard(store.ownerId);

    expect(dash.inbox).toMatchObject({ unread: 2, openThreads: 2 });
    expect(dash.engagement.inquiriesAllTime).toBe(2);
    expect(dash.engagement.inquiriesThisPeriod).toBe(2);
    expect(dash.alerts.find((a) => a.type === 'UNREAD')?.severity).toBe('warning');
  });

  it('frames engagement by the paid period once active', async () => {
    const store = await makeStore('window');
    await subscriptions.chargeSubscription(store.id);

    const dash = await getDashboard(store.ownerId);
    const sub = await prisma.subscription.findUnique({ where: { storeId: store.id } });

    // "What your last $5 bought" — not an all-time number dressed up as monthly.
    expect(dash.engagement.since).toEqual(sub!.currentPeriodStart);
  });

  it('falls back to a 30-day window when not active', async () => {
    const store = await makeStore('nowindow');
    const dash = await getDashboard(store.ownerId);

    const daysAgo = (Date.now() - dash.engagement.since.getTime()) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
  });

  it('counts reviews the vendor has not answered', async () => {
    const store = await makeStore('unreplied');
    await prisma.store.update({ where: { id: store.id }, data: { status: 'ACTIVE' } });
    const listing = await makeListing(store.id);

    const buyer = await makeBuyer('reviewer');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'A question here' });
    const review = await reviews.createReview(buyer, listing.id, {
      rating: 4, comment: 'Reasonable seller, decent item.',
    });

    let dash = await getDashboard(store.ownerId);
    // vendorReply is unset, not null — matching only null would report zero forever.
    expect(dash.reputation.unrepliedReviews).toBe(1);
    expect(dash.reputation).toMatchObject({ avgRating: 4, reviewCount: 1 });

    await reviews.replyToReview(store.ownerId, review.id, 'Thanks for the feedback');
    dash = await getDashboard(store.ownerId);
    expect(dash.reputation.unrepliedReviews).toBe(0);
  });

  it('shows response metrics buyers can see', async () => {
    const store = await makeStore('response');
    await prisma.store.update({ where: { id: store.id }, data: { status: 'ACTIVE' } });
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('responder');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'A question here' });
    await chat.sendMessage(store.ownerId, convo!.id, 'A prompt reply');

    const dash = await getDashboard(store.ownerId);
    expect(dash.engagement.responseRate).toBe(1);
    expect(dash.engagement.avgResponseMins).toBe(0);
  });

  it('leads with suspension when the store is suspended', async () => {
    const store = await makeStore('suspended');
    await prisma.store.update({ where: { id: store.id }, data: { status: 'SUSPENDED' } });

    const dash = await getDashboard(store.ownerId);
    expect(dash.alerts[0]).toMatchObject({ type: 'SUSPENDED', severity: 'critical' });
    expect(dash.store.publiclyVisible).toBe(false);
  });

  it('404s for a user with no store', async () => {
    const id = `${PREFIX}nostore`;
    await createTestUser({ userId: id });
    await expect(getDashboard(id)).rejects.toThrow(/do not have a store/i);
  });
});
