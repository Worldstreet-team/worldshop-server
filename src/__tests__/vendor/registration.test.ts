import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as vendorService from '../../services/vendor.service';

describe('vendor registration', () => {
  // Clean up any leftover data from prior crashed runs
  beforeAll(async () => {
    await prisma.userProfile.deleteMany({});
  });

  afterEach(async () => {
    await prisma.userProfile.deleteMany({});
  });

  // ─── Tracer bullet: register as vendor ───────────────────────────
  it('registers a customer as a vendor with correct slug', async () => {
    const user = await createTestUser({ userId: 'user-register-1' });

    const profile = await vendorService.registerVendor(user.userId, {
      storeName: 'My Cool Store',
      storeDescription: 'Selling cool stuff',
    });

    expect(profile.isVendor).toBe(true);
    expect(profile.vendorStatus).toBe('ACTIVE');
    expect(profile.storeName).toBe('My Cool Store');
    expect(profile.storeSlug).toBe('my-cool-store');
    expect(profile.storeDescription).toBe('Selling cool stuff');
    expect(profile.vendorSince).toBeInstanceOf(Date);
  });

  // ─── Duplicate slug rejected ──────────────────────────────────────
  it('rejects registration when store slug already exists', async () => {
    const user1 = await createTestUser({ userId: 'user-dup-1' });

    await vendorService.registerVendor(user1.userId, {
      storeName: 'Unique Store',
    });

    const user2 = await createTestUser({ userId: 'user-dup-2' });

    await expect(
      vendorService.registerVendor(user2.userId, {
        storeName: 'Unique Store',
      }),
    ).rejects.toThrow(/similar name already exists/);
  });

  // ─── Reserved slugs rejected ─────────────────────────────────────
  it.each(['admin', 'vendor', 'account', 'auth', 'store'])(
    'rejects reserved slug: %s',
    async (reserved) => {
      const user = await createTestUser({ userId: `user-reserved-${reserved}` });

      await expect(
        vendorService.registerVendor(user.userId, {
          storeName: reserved,
        }),
      ).rejects.toThrow(/reserved/);
    },
  );

  // ─── Already a vendor rejected ────────────────────────────────────
  it('rejects registration when user is already a vendor', async () => {
    const user = await createTestUser({
      userId: 'user-already-vendor',
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Existing Store',
      storeSlug: 'existing-store',
    });

    await expect(
      vendorService.registerVendor(user.userId, {
        storeName: 'Another Store',
      }),
    ).rejects.toThrow(/already registered/);
  });
});
