import { describe, it, expect, beforeAll, afterEach, vi, beforeEach } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';

// The wallet is a separate service; these tests exercise the state machine
// around it, not the HTTP call. `chargeWalletUsd` is the only boundary.
const chargeWalletUsd = vi.hoisted(() => vi.fn());
vi.mock('../../services/payment/providers/wallet.provider', () => ({ chargeWalletUsd }));

import * as storeService from '../../services/marketplace.store.service';
import * as subscriptionService from '../../services/subscription.service';
import * as creditService from '../../services/store-credit.service';

const PREFIX = 'subtest-';
const PLAN_CODE = 'test-standard';

async function cleanup() {
  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length) {
    await prisma.subscriptionCharge.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.storeCreditEntry.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.subscription.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

async function makeStore(name: string) {
  const ownerId = `${PREFIX}${name}`;
  await createTestUser({ userId: ownerId });
  return storeService.createStore(ownerId, {
    name: `${name} Store`,
    state: 'Lagos',
    planCode: PLAN_CODE,
  });
}

/** Same reference every time, so re-granting exercises the idempotency guard. */
function grantCredit(storeId: string, amountMinor: number) {
  return creditService.recordCredit({
    storeId,
    type: 'ADMIN_GRANT',
    amountMinor,
    reference: `test-grant:${storeId}`,
  });
}

function walletSucceeds() {
  chargeWalletUsd.mockResolvedValue({ ok: true, walletRef: 'WSWALLET:u:hold1', amountMinor: 500 });
}

function walletDeclines() {
  chargeWalletUsd.mockResolvedValue({
    ok: false,
    code: 'INSUFFICIENT_BALANCE',
    message: 'Insufficient balance',
  });
}

describe('monthly billing periods', () => {
  const monthly = { intervalMonths: 1, intervalDays: 30 };
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('lands on the same date next month, not 30 days later', () => {
    // 30-day cycles would give 2026-04-02 and drift a day every month.
    expect(iso(subscriptionService.addInterval(new Date('2026-03-03T09:00:00Z'), monthly)))
      .toBe('2026-04-03');
  });

  it('clamps to the end of a shorter month instead of overflowing', () => {
    // Naive month arithmetic rolls 31 Jan into 3 March, skipping February.
    expect(iso(subscriptionService.addInterval(new Date('2026-01-31T09:00:00Z'), monthly)))
      .toBe('2026-02-28');
    expect(iso(subscriptionService.addInterval(new Date('2026-05-31T09:00:00Z'), monthly)))
      .toBe('2026-06-30');
  });

  it('handles leap years and year rollover', () => {
    expect(iso(subscriptionService.addInterval(new Date('2028-01-31T09:00:00Z'), monthly)))
      .toBe('2028-02-29');
    expect(iso(subscriptionService.addInterval(new Date('2026-12-15T09:00:00Z'), monthly)))
      .toBe('2027-01-15');
  });

  it('falls back to day-based cycles when no month interval is set', () => {
    expect(iso(subscriptionService.addInterval(new Date('2026-03-03T09:00:00Z'), { intervalMonths: null, intervalDays: 7 })))
      .toBe('2026-03-10');
  });

  it('keeps the clock time, so renewals do not creep', () => {
    const out = subscriptionService.addInterval(new Date('2026-03-03T09:30:00Z'), monthly);
    expect(out.toISOString()).toBe('2026-04-03T09:30:00.000Z');
  });
});

describe('store subscriptions', () => {
  beforeAll(async () => {
    await prisma.subscriptionPlan.upsert({
      where: { code: PLAN_CODE },
      create: {
        code: PLAN_CODE,
        name: 'Test Standard',
        amountMinor: 500,
        intervalDays: 30,
        graceDays: 7,
        perks: [],
      },
      update: { amountMinor: 500, intervalDays: 30, graceDays: 7, isActive: true },
    });
    await cleanup();
  });

  beforeEach(() => {
    chargeWalletUsd.mockReset();
  });

  afterEach(cleanup);

  it('creates stores in DRAFT — invisible until paid', async () => {
    const store = await makeStore('draft');

    expect(store.status).toBe('DRAFT');
    expect(store.isPubliclyVisible).toBe(false);
    expect(store.subscription?.status).toBe('PENDING_PAYMENT');
    expect(await storeService.getPublicStoreBySlug(store.slug)).toBeNull();
  });

  it('exposes only buyer-facing fields on the public store shape', async () => {
    walletSucceeds();
    const store = await makeStore('publicshape');
    await subscriptionService.chargeSubscription(store.id);
    await grantCredit(store.id, 250);

    const pub = await storeService.getPublicStoreBySlug(store.slug);
    expect(pub).not.toBeNull();
    // Buyers need these to decide whether to make contact.
    expect(pub).toMatchObject({ id: store.id, slug: store.slug, state: 'Lagos', status: 'ACTIVE' });
    // Owner identity, account email, credit balance and admin audit fields
    // are private. A Store field added later stays private until whitelisted.
    for (const key of ['ownerId', 'email', 'creditMinor', 'verifiedBy', 'inquiryCount', 'viewCount', 'updatedAt']) {
      expect(pub, key).not.toHaveProperty(key);
    }

    const { stores } = await storeService.listPublicStores({ page: 1, limit: 100 });
    const listed = stores.find((s) => s.id === store.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('ownerId');
    expect(listed).not.toHaveProperty('creditMinor');
  });

  it('goes live once the first charge clears', async () => {
    walletSucceeds();
    const store = await makeStore('activates');

    const outcome = await subscriptionService.chargeSubscription(store.id);

    expect(outcome).toMatchObject({ charged: true, alreadyPaid: false });
    expect(await storeService.getPublicStoreBySlug(store.slug)).not.toBeNull();

    const sub = await subscriptionService.getSubscriptionForStore(store.id);
    expect(sub?.status).toBe('ACTIVE');
    expect(sub?.charges[0]?.status).toBe('PAID');
  });

  it('does not charge twice when the activation request is repeated', async () => {
    walletSucceeds();
    const store = await makeStore('idempotent');

    const first = await subscriptionService.chargeSubscription(store.id);
    const second = await subscriptionService.chargeSubscription(store.id);

    expect(first).toMatchObject({ charged: true, alreadyPaid: false });
    expect(second).toMatchObject({ charged: true, alreadyPaid: true });
    // The wallet is only ever asked once for a period already paid.
    expect(chargeWalletUsd).toHaveBeenCalledTimes(1);

    const charges = await prisma.subscriptionCharge.findMany({ where: { storeId: store.id } });
    expect(charges).toHaveLength(1);
  });

  it('leaves an unpaid store dark when the wallet declines', async () => {
    walletDeclines();
    const store = await makeStore('declined');

    const outcome = await subscriptionService.chargeSubscription(store.id);

    expect(outcome).toMatchObject({ charged: false, code: 'INSUFFICIENT_BALANCE' });
    expect(await storeService.getPublicStoreBySlug(store.slug)).toBeNull();

    const sub = await subscriptionService.getSubscriptionForStore(store.id);
    expect(sub?.status).toBe('PENDING_PAYMENT');
    expect(sub?.charges[0]?.status).toBe('FAILED');
  });

  it('keeps a paid-up store visible through a failed renewal (grace)', async () => {
    walletSucceeds();
    const store = await makeStore('grace');
    await subscriptionService.chargeSubscription(store.id);

    // Force the period to have ended, then fail the renewal.
    await prisma.subscription.update({
      where: { storeId: store.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    walletDeclines();

    const report = await subscriptionService.runRenewalSweep();
    expect(report.failed).toBeGreaterThanOrEqual(1);

    const sub = await subscriptionService.getSubscriptionForStore(store.id);
    expect(sub?.status).toBe('GRACE');
    // Still visible — a failed payment is not the same as leaving.
    expect(await storeService.getPublicStoreBySlug(store.slug)).not.toBeNull();
  });

  it('hides the store once the grace window closes', async () => {
    walletSucceeds();
    const store = await makeStore('lapses');
    await subscriptionService.chargeSubscription(store.id);

    await prisma.subscription.update({
      where: { storeId: store.id },
      data: {
        status: 'GRACE',
        currentPeriodEnd: new Date(Date.now() - 1000),
        graceEndsAt: new Date(Date.now() - 1000),
      },
    });

    await subscriptionService.runRenewalSweep();

    const sub = await subscriptionService.getSubscriptionForStore(store.id);
    expect(sub?.status).toBe('LAPSED');
    expect(await storeService.getPublicStoreBySlug(store.slug)).toBeNull();

    const stored = await prisma.store.findUnique({ where: { id: store.id } });
    expect(stored?.status).toBe('EXPIRED');
  });

  it('restores a lapsed store when the vendor pays again', async () => {
    walletDeclines();
    const store = await makeStore('recovers');
    await subscriptionService.chargeSubscription(store.id);

    walletSucceeds();
    const outcome = await subscriptionService.chargeSubscription(store.id);

    expect(outcome).toMatchObject({ charged: true });
    expect(await storeService.getPublicStoreBySlug(store.slug)).not.toBeNull();
  });

  it('bills a renewal forward from the period end, not from today', async () => {
    walletSucceeds();
    const store = await makeStore('renews');
    await subscriptionService.chargeSubscription(store.id);

    const before = await prisma.subscription.findUnique({ where: { storeId: store.id } });
    const periodEnd = before!.currentPeriodEnd!;

    await subscriptionService.chargeSubscription(store.id, { allowPrepay: true });
    const after = await prisma.subscription.findUnique({ where: { storeId: store.id } });

    // Paying early must extend the existing period, never truncate it.
    expect(after!.currentPeriodEnd!.getTime()).toBeGreaterThan(periodEnd.getTime());
    expect(after!.currentPeriodStart!.getTime()).toBe(periodEnd.getTime());
  });

  it('pays from store credit without touching the wallet', async () => {
    const store = await makeStore('credit');
    await grantCredit(store.id, 1500); // three months

    const outcome = await subscriptionService.chargeSubscription(store.id);

    expect(outcome).toMatchObject({ charged: true });
    expect(chargeWalletUsd).not.toHaveBeenCalled();

    const stored = await prisma.store.findUnique({ where: { id: store.id } });
    expect(stored?.creditMinor).toBe(1000);

    const charge = await prisma.subscriptionCharge.findFirst({ where: { storeId: store.id } });
    expect(charge).toMatchObject({ status: 'PAID', creditMinor: 500, walletMinor: 0 });
    expect(await storeService.getPublicStoreBySlug(store.slug)).not.toBeNull();
  });

  it('splits a period between partial credit and the wallet', async () => {
    walletSucceeds();
    const store = await makeStore('partial');
    await grantCredit(store.id, 200); // $2 of the $5

    await subscriptionService.chargeSubscription(store.id);

    expect(chargeWalletUsd).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 300 }));

    const charge = await prisma.subscriptionCharge.findFirst({ where: { storeId: store.id } });
    expect(charge).toMatchObject({ creditMinor: 200, walletMinor: 300 });

    const stored = await prisma.store.findUnique({ where: { id: store.id } });
    expect(stored?.creditMinor).toBe(0);
  });

  it('returns spent credit when the wallet declines the remainder', async () => {
    walletDeclines();
    const store = await makeStore('reversal');
    await grantCredit(store.id, 200);

    const outcome = await subscriptionService.chargeSubscription(store.id);

    expect(outcome).toMatchObject({ charged: false });
    // Credit must not be consumed by a period the vendor never received.
    const stored = await prisma.store.findUnique({ where: { id: store.id } });
    expect(stored?.creditMinor).toBe(200);

    const entries = await prisma.storeCreditEntry.findMany({ where: { storeId: store.id } });
    expect(entries.map((e) => e.type)).toContain('REVERSAL');
  });

  it('never double-spends credit on a replayed grant', async () => {
    const store = await makeStore('replay');
    const first = await grantCredit(store.id, 500);
    const second = await grantCredit(store.id, 500); // same reference

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    const stored = await prisma.store.findUnique({ where: { id: store.id } });
    expect(stored?.creditMinor).toBe(500);
  });

  it('rejects a second store for the same owner', async () => {
    const store = await makeStore('duplicate');
    await expect(
      storeService.createStore(store.ownerId, {
        name: 'Another Store',
        state: 'Abuja',
        planCode: PLAN_CODE,
      }),
    ).rejects.toThrow(/already have a store/i);
  });

  it('keeps auto-renewal off but the store visible after cancelling', async () => {
    walletSucceeds();
    const store = await makeStore('cancels');
    await subscriptionService.chargeSubscription(store.id);

    await subscriptionService.cancelSubscription(store.id);

    const sub = await subscriptionService.getSubscriptionForStore(store.id);
    expect(sub?.status).toBe('CANCELLED');
    expect(sub?.autoRenew).toBe(false);
    // Paid time is not forfeited by cancelling.
    expect(await storeService.getPublicStoreBySlug(store.slug)).not.toBeNull();
  });

  it('never charges or resurrects an admin-suspended store', async () => {
    walletSucceeds();
    const store = await makeStore('suspended');
    await subscriptionService.chargeSubscription(store.id);

    // Admin takes the store down; a due renewal must not undo that.
    await prisma.store.update({ where: { id: store.id }, data: { status: 'SUSPENDED' } });
    await expect(
      subscriptionService.chargeSubscription(store.id, { allowPrepay: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.status).toBe('SUSPENDED');
    expect(chargeWalletUsd).toHaveBeenCalledTimes(1);
  });

  it('expires a cancelled store at the end of the paid period, and paying again resubscribes', async () => {
    walletSucceeds();
    const store = await makeStore('cancelexpires');
    await subscriptionService.chargeSubscription(store.id);
    await subscriptionService.cancelSubscription(store.id);

    // Still inside the paid period: the sweep leaves the store visible.
    await subscriptionService.runRenewalSweep();
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.status).toBe('ACTIVE');

    // Period over: cancellation now takes effect.
    await prisma.subscription.update({
      where: { storeId: store.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    await subscriptionService.runRenewalSweep();
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.status).toBe('EXPIRED');
    expect(await storeService.getPublicStoreBySlug(store.slug)).toBeNull();
    // The subscription stays CANCELLED so a later payment reads as a resubscribe.
    expect((await prisma.subscription.findUnique({ where: { storeId: store.id } }))?.status).toBe('CANCELLED');

    // Charging a CANCELLED subscription is the resubscribe path.
    const outcome = await subscriptionService.chargeSubscription(store.id);
    expect(outcome.charged).toBe(true);
    const after = await prisma.subscription.findUnique({ where: { storeId: store.id } });
    expect(after?.status).toBe('ACTIVE');
    expect(after?.autoRenew).toBe(true);
    expect(after?.cancelledAt).toBeNull();
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.status).toBe('ACTIVE');
  });
});
