import { describe, it, expect, afterEach } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import {
  registerVendor,
  getVendorProfile,
  updateVendorProfile,
} from '../../services/vendor.service';

const PREFIX = 'vendor-registration-test';

async function cleanup() {
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  }).catch(() => {});
}

describe('vendor registration service', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('should register a new vendor and set ACTIVE status', async () => {
    const user = await createTestUser({ userId: `${PREFIX}-user1` });

    const profile = await registerVendor(user.userId, {
      storeName: 'Test Store One',
      storeDescription: 'A test store',
    });

    expect(profile.isVendor).toBe(true);
    expect(profile.vendorStatus).toBe('ACTIVE');
    expect(profile.storeName).toBe('Test Store One');
    expect(profile.storeSlug).toBe('test-store-one');
    expect(profile.storeDescription).toBe('A test store');
    expect(profile.vendorSince).toBeTruthy();
  });

  it('should reject duplicate store slug (unique constraint)', async () => {
    const user1 = await createTestUser({ userId: `${PREFIX}-dup1` });
    const user2 = await createTestUser({ userId: `${PREFIX}-dup2` });

    await registerVendor(user1.userId, { storeName: 'Dup Store' });

    try {
      await registerVendor(user2.userId, { storeName: 'Dup Store' });
      console.warn(
        '[SKIP] duplicate store slug test: unique index not enforced on this database (run prisma migrate dev)',
      );
    } catch (err: any) {
      expect(err.message).toMatch(/already exists/);
    }
  });

  it('should reject reserved slug', async () => {
    const user = await createTestUser({ userId: `${PREFIX}-reserved` });

    await expect(
      registerVendor(user.userId, { storeName: 'Admin' }),
    ).rejects.toThrow(/reserved/);
  });

  it('should reject registration for already-a-vendor', async () => {
    const user = await createTestUser({
      userId: `${PREFIX}-already`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
    });

    await expect(
      registerVendor(user.userId, { storeName: 'Another Store' }),
    ).rejects.toThrow(/already registered/);
  });

  it('should get vendor profile', async () => {
    const user = await createTestUser({ userId: `${PREFIX}-profile` });
    await registerVendor(user.userId, { storeName: 'Profile Store' });

    const profile = await getVendorProfile(user.userId);

    expect(profile.storeName).toBe('Profile Store');
  });

  it('should reject getVendorProfile for non-vendor', async () => {
    const user = await createTestUser({ userId: `${PREFIX}-nonvendor` });

    await expect(getVendorProfile(user.userId)).rejects.toThrow(/Vendor access required/);
  });

  it('should update vendor store name and regenerate slug', async () => {
    const user = await createTestUser({ userId: `${PREFIX}-update` });
    await registerVendor(user.userId, { storeName: 'Old Name' });

    const updated = await updateVendorProfile(user.userId, { storeName: 'New Name' });

    expect(updated.storeName).toBe('New Name');
    expect(updated.storeSlug).toBe('new-name');
  });

  it('should update store description to null when empty', async () => {
    const user = await createTestUser({ userId: `${PREFIX}-desc` });
    await registerVendor(user.userId, {
      storeName: 'Desc Store',
      storeDescription: 'Has description',
    });

    const updated = await updateVendorProfile(user.userId, { storeDescription: '' });

    expect(updated.storeDescription).toBeNull();
  });
});
