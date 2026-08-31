import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';

// The wallet is a separate service; these tests exercise the mall state
// machine and cascade around it, not the HTTP call.
const chargeWalletUsd = vi.hoisted(() => vi.fn());
vi.mock('../../services/payment/providers/wallet.provider', () => ({ chargeWalletUsd }));

import * as mallService from '../../services/mall.service';
import * as mallSubscriptionService from '../../services/mall.subscription.service';
import * as storeService from '../../services/marketplace.store.service';

const PREFIX = 'malltest-';
const PLAN_CODE = 'test-mall';

async function cleanup() {
  const malls = await prisma.mall.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const mallIds = malls.map((m) => m.id);

  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length) {
    await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.subscription.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }
  if (mallIds.length) {
    await prisma.mallSubscriptionCharge.deleteMany({ where: { mallId: { in: mallIds } } });
    await prisma.mallSubscription.deleteMany({ where: { mallId: { in: mallIds } } });
    await prisma.mall.deleteMany({ where: { id: { in: mallIds } } });
  }
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

async function makeMall(name: string) {
  const ownerId = `${PREFIX}${name}`;
  await createTestUser({ userId: ownerId });
  const mall = await mallService.createMall(ownerId, {
    name: `${name} Mall`,
    state: 'Lagos',
    planCode: PLAN_CODE,
  });
  return { ownerId, mall };
}

async function makeListing(storeId: string, name: string, status = 'PUBLISHED') {
  return prisma.product.create({
    data: {
      name,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      description: 'Test listing',
      basePrice: 1000,
      status: status as never,
      storeId,
    },
  });
}

function walletSucceeds() {
  chargeWalletUsd.mockResolvedValue({ ok: true, walletRef: 'WSWALLET:u:mall1', amountMinor: 10000 });
}

function walletDeclines() {
  chargeWalletUsd.mockResolvedValue({
    ok: false,
    code: 'INSUFFICIENT_BALANCE',
    message: 'Insufficient balance',
  });
}

describe('malls', () => {
  beforeAll(async () => {
    await prisma.subscriptionPlan.upsert({
      where: { code: PLAN_CODE },
      create: {
        code: PLAN_CODE,
        name: 'Test Mall',
        amountMinor: 10000,
        intervalDays: 30,
        graceDays: 7,
        kind: 'MALL',
        substoreLimit: 2,
      },
      update: { kind: 'MALL', substoreLimit: 2, isActive: true },
    });
    // The personal-store cases lean on the store test plan; make sure it
    // exists even when this file runs alone.
    await prisma.subscriptionPlan.upsert({
      where: { code: 'test-standard' },
      create: {
        code: 'test-standard',
        name: 'Test Standard',
        amountMinor: 500,
        intervalDays: 30,
        graceDays: 7,
      },
      update: { isActive: true, kind: 'STORE' },
    });
    await cleanup();
  });

  beforeEach(() => {
    chargeWalletUsd.mockReset();
  });

  afterEach(cleanup);

  it('creates malls in DRAFT with a pending subscription — one per user', async () => {
    const { ownerId, mall } = await makeMall('draft');

    expect(mall.status).toBe('DRAFT');
    expect(mall.isPubliclyVisible).toBe(false);
    expect(mall.subscription?.status).toBe('PENDING_PAYMENT');
    expect(await mallService.getPublicMallBySlug(mall.slug)).toBeNull();

    await expect(
      mallService.createMall(ownerId, { name: 'Second Mall', state: 'Lagos', planCode: PLAN_CODE }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('lets a mall owner also own a personal store, but still only one', async () => {
    const { ownerId } = await makeMall('both');

    const store = await storeService.createStore(ownerId, {
      name: 'Both Personal Store',
      state: 'Lagos',
      planCode: 'test-standard',
    });
    expect(store.status).toBe('DRAFT');

    await expect(
      storeService.createStore(ownerId, { name: 'Another', state: 'Lagos', planCode: 'test-standard' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a STORE plan for a mall', async () => {
    const ownerId = `${PREFIX}wrongplan`;
    await createTestUser({ userId: ownerId });
    await expect(
      mallService.createMall(ownerId, { name: 'Wrong Plan Mall', state: 'Lagos', planCode: 'test-standard' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('enforces the plan substore cap', async () => {
    const { ownerId } = await makeMall('cap');

    await mallService.createSubstore(ownerId, { name: 'Cap Sub One' });
    await mallService.createSubstore(ownerId, { name: 'Cap Sub Two' });
    await expect(
      mallService.createSubstore(ownerId, { name: 'Cap Sub Three' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('activates the mall AND pre-payment substores on the first charge', async () => {
    const { ownerId, mall } = await makeMall('activate');

    // Created while the mall is unpaid → hidden pending billing.
    const sub = await mallService.createSubstore(ownerId, { name: 'Activate Sub' });
    expect(sub.status).toBe('EXPIRED');
    // Location defaults to the mall's.
    expect(sub.state).toBe('Lagos');

    walletSucceeds();
    const outcome = await mallSubscriptionService.chargeMallSubscription(mall.id);
    expect(outcome.charged).toBe(true);

    const after = await prisma.mall.findUnique({ where: { id: mall.id } });
    expect(after?.status).toBe('ACTIVE');
    const subAfter = await prisma.store.findUnique({ where: { id: sub.id } });
    expect(subAfter?.status).toBe('ACTIVE');

    expect(await mallService.getPublicMallBySlug(mall.slug)).not.toBeNull();
  });

  it('is idempotent within a paid period — one charge row, one wallet call', async () => {
    const { mall } = await makeMall('idem');

    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);
    const second = await mallSubscriptionService.chargeMallSubscription(mall.id);

    expect(second.charged).toBe(true);
    expect((second as { alreadyPaid: boolean }).alreadyPaid).toBe(true);
    expect(chargeWalletUsd).toHaveBeenCalledTimes(1);
    expect(await prisma.mallSubscriptionCharge.count({ where: { mallId: mall.id } })).toBe(1);
  });

  it('cascades GRACE on a failed renewal, EXPIRED after grace, ACTIVE on recovery', async () => {
    const { ownerId, mall } = await makeMall('lapse');
    const sub = await mallService.createSubstore(ownerId, { name: 'Lapse Sub' });

    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);

    // Push the paid period into the past so a renewal is due.
    await prisma.mallSubscription.update({
      where: { mallId: mall.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });

    walletDeclines();
    const failed = await mallSubscriptionService.chargeMallSubscription(mall.id);
    expect(failed.charged).toBe(false);

    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('GRACE');
    expect((await prisma.store.findUnique({ where: { id: sub.id } }))?.status).toBe('GRACE');

    // Close the grace window and sweep — everything hides together.
    await prisma.mallSubscription.update({
      where: { mallId: mall.id },
      data: { graceEndsAt: new Date(Date.now() - 1000), autoRenew: false },
    });
    await mallSubscriptionService.runMallRenewalSweep();

    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('EXPIRED');
    expect((await prisma.store.findUnique({ where: { id: sub.id } }))?.status).toBe('EXPIRED');
    expect(await mallService.getPublicMallBySlug(mall.slug)).toBeNull();

    // Paying again brings the mall and its substores back.
    walletSucceeds();
    const recovered = await mallSubscriptionService.chargeMallSubscription(mall.id);
    expect(recovered.charged).toBe(true);
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('ACTIVE');
    expect((await prisma.store.findUnique({ where: { id: sub.id } }))?.status).toBe('ACTIVE');
  });

  it('never charges or resurrects an admin-suspended mall', async () => {
    const { mall } = await makeMall('suspended');

    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);

    // Admin takes the mall down; a due renewal must not undo that.
    await prisma.mall.update({ where: { id: mall.id }, data: { status: 'SUSPENDED' } });
    await expect(
      mallSubscriptionService.chargeMallSubscription(mall.id, { allowPrepay: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('SUSPENDED');
    expect(chargeWalletUsd).toHaveBeenCalledTimes(1);
  });

  it('expires a cancelled mall at the end of the paid period, and paying again resubscribes', async () => {
    const { ownerId, mall } = await makeMall('cancel');
    const sub = await mallService.createSubstore(ownerId, { name: 'Cancel Sub' });

    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);
    await mallSubscriptionService.cancelMallSubscription(mall.id);

    // Still inside the paid period: the sweep leaves everything visible.
    await mallSubscriptionService.runMallRenewalSweep();
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('ACTIVE');

    // Period over: cancellation now takes effect.
    await prisma.mallSubscription.update({
      where: { mallId: mall.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    await mallSubscriptionService.runMallRenewalSweep();
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('EXPIRED');
    expect((await prisma.store.findUnique({ where: { id: sub.id } }))?.status).toBe('EXPIRED');

    // Charging a CANCELLED subscription is the resubscribe path.
    const outcome = await mallSubscriptionService.chargeMallSubscription(mall.id);
    expect(outcome.charged).toBe(true);
    const after = await prisma.mallSubscription.findUnique({ where: { mallId: mall.id } });
    expect(after?.status).toBe('ACTIVE');
    expect(after?.autoRenew).toBe(true);
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.status).toBe('ACTIVE');
  });

  it('rejects a double archive and restores an archived substore into a plan slot', async () => {
    const { ownerId, mall } = await makeMall('rearchive');
    const sub = await mallService.createSubstore(ownerId, { name: 'Rearchive Sub' });

    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);
    await makeListing(sub.id, 'Rearchive Listing');

    await mallService.archiveSubstore(ownerId, sub.id);
    // A repeat archive must not decrement the slot counter again.
    await expect(mallService.archiveSubstore(ownerId, sub.id)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.substoreCount).toBe(0);

    const restored = await mallService.restoreSubstore(ownerId, sub.id);
    expect(restored.status).toBe('ACTIVE'); // mall is paid up
    expect((await prisma.mall.findUnique({ where: { id: mall.id } }))?.substoreCount).toBe(1);
    await expect(mallService.restoreSubstore(ownerId, sub.id)).rejects.toMatchObject({ status: 409 });
  });

  it('never resurrects an owner-archived (DRAFT) substore on payment', async () => {
    const { ownerId, mall } = await makeMall('archive');
    const sub = await mallService.createSubstore(ownerId, { name: 'Archive Sub' });

    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);

    // Give it history so archive hides instead of deletes.
    await makeListing(sub.id, 'Archive Listing');
    const result = await mallService.archiveSubstore(ownerId, sub.id);
    expect(result.deleted).toBe(false);
    expect((await prisma.store.findUnique({ where: { id: sub.id } }))?.status).toBe('DRAFT');

    // A renewal (prepay) must not flip it back.
    await mallSubscriptionService.chargeMallSubscription(mall.id, { allowPrepay: true });
    expect((await prisma.store.findUnique({ where: { id: sub.id } }))?.status).toBe('DRAFT');
  });

  it('validates featured listings: substore-owned, published, capped at 12', async () => {
    const { ownerId, mall } = await makeMall('featured');
    const sub = await mallService.createSubstore(ownerId, { name: 'Featured Sub' });

    const published = await makeListing(sub.id, 'Feat Published');
    const draft = await makeListing(sub.id, 'Feat Draft', 'DRAFT');

    // A listing from someone else's store entirely.
    const stranger = `${PREFIX}stranger`;
    await createTestUser({ userId: stranger });
    const strangerStore = await storeService.createStore(stranger, {
      name: 'Stranger Store',
      state: 'Lagos',
      planCode: 'test-standard',
    });
    const foreign = await makeListing(strangerStore.id, 'Feat Foreign');

    await expect(mallService.setFeaturedListings(ownerId, [draft.id])).rejects.toMatchObject({ status: 400 });
    await expect(mallService.setFeaturedListings(ownerId, [foreign.id])).rejects.toMatchObject({ status: 400 });
    await expect(
      mallService.setFeaturedListings(ownerId, Array.from({ length: 13 }, () => published.id)),
    ).resolves.toBeTruthy(); // 13 duplicates dedupe to 1 — allowed

    const updated = await mallService.setFeaturedListings(ownerId, [published.id]);
    expect(updated.featuredListingIds).toEqual([published.id]);

    // The public page re-filters: unpublishing drops it from the rail.
    walletSucceeds();
    await mallSubscriptionService.chargeMallSubscription(mall.id);
    await prisma.product.update({ where: { id: published.id }, data: { status: 'HIDDEN' } });
    const page = await mallService.getPublicMallBySlug(mall.slug);
    expect(page?.featuredListings).toHaveLength(0);
  });
});
