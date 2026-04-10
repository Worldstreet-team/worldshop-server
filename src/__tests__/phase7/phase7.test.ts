import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as vendorReviewService from '../../services/vendor.review.service';
import * as adminVendorService from '../../services/admin.vendor.service';
import { getCommissionReport } from '../../services/ledger.read.service';
import { settleOrder } from '../../services/ledger.write.service';
import { OrderStatus } from '../../../generated/prisma';

const PREFIX = 'phase7-test';

// ─── Helpers ────────────────────────────────────────────────────

async function cleanup() {
  // Ledger cleanup
  await prisma.ledgerEntry.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  });
  await prisma.vendorBalance.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  });

  // Reviews cleanup
  await prisma.review.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });

  // Orders cleanup
  const orders = await prisma.order.findMany({
    where: { userId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await prisma.orderStatusHistory.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: orderIds } },
    });
  }
  await prisma.order.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });

  // Products cleanup
  await prisma.product.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  });

  // Users cleanup
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });

  // Platform config cleanup
  await prisma.platformConfig.deleteMany({
    where: { key: 'commissionRate' },
  });
}

let counter = 0;
function unique(base: string) {
  counter++;
  return `${PREFIX}-${base}-${Date.now()}-${counter}`;
}

async function createVendor(slug: string) {
  return createTestUser({
    userId: `${PREFIX}-vendor-${slug}`,
    email: `${PREFIX}-vendor-${slug}@test.com`,
    firstName: 'Vendor',
    lastName: slug,
    isVendor: true,
    vendorStatus: 'ACTIVE',
    storeName: `Test Store ${slug}`,
    storeSlug: `${PREFIX}-store-${slug}`,
    storeDescription: `Store ${slug} description`,
  });
}

async function createProduct(vendorUserId: string, name?: string) {
  const pname = name ?? unique('product');
  return prisma.product.create({
    data: {
      name: pname,
      slug: unique('slug'),
      description: 'Test product',
      basePrice: 5000,
      type: 'DIGITAL',
      isActive: true,
      vendorId: vendorUserId,
      stockKeepingUnit: unique('sku'),
      tags: [],
      images: [],
    },
  });
}

async function createReviewOnProduct(
  productId: string,
  userId: string,
  rating: number,
  comment: string = 'Great product, highly recommended!',
) {
  return prisma.review.create({
    data: {
      productId,
      userId,
      userName: `User ${userId}`,
      rating,
      comment,
      isVerified: true,
    },
  });
}

async function createOrder(opts: {
  vendorId: string;
  buyerId: string;
  productId: string;
  total: number;
  status?: OrderStatus;
}) {
  return prisma.order.create({
    data: {
      orderNumber: unique('ORD'),
      userId: opts.buyerId,
      vendorId: opts.vendorId,
      status: opts.status ?? OrderStatus.PAID,
      subtotal: opts.total,
      total: opts.total,
      items: {
        create: {
          productId: opts.productId,
          productName: 'Test Product',
          quantity: 1,
          unitPrice: opts.total,
          totalPrice: opts.total,
        },
      },
      statusHistory: {
        create: { status: opts.status ?? OrderStatus.PAID, note: 'Test' },
      },
    },
  });
}

async function seedCommissionRate(rate: string = '0.10') {
  await prisma.platformConfig.upsert({
    where: { key: 'commissionRate' },
    update: { value: rate },
    create: { key: 'commissionRate', value: rate },
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Phase 7: Vendor Reviews & Admin Vendor Management', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  // ─── Vendor Reviews ─────────────────────────────────────────

  describe('vendor reviews', () => {
    it('returns reviews for vendor products (paginated)', async () => {
      const vendor = await createVendor('review-v1');
      const product1 = await createProduct(vendor.userId, unique('prod1'));
      const product2 = await createProduct(vendor.userId, unique('prod2'));

      // Reviews don't require UserProfile — just use raw userIds
      await createReviewOnProduct(product1.id, `${PREFIX}-buyer-r1`, 5);
      await createReviewOnProduct(product1.id, `${PREFIX}-buyer-r2`, 4);
      await createReviewOnProduct(product2.id, `${PREFIX}-buyer-r3`, 3);

      const result = await vendorReviewService.getVendorReviews(vendor.userId, {
        page: 1,
        limit: 10,
      });

      expect(result.data.length).toBe(3);
      expect(result.pagination.total).toBe(3);
      // Each review includes product name
      expect(result.data[0].productName).toBeTruthy();
    });

    it('returns empty for vendor with no reviews', async () => {
      const vendor = await createVendor('review-v2');
      await createProduct(vendor.userId);

      const result = await vendorReviewService.getVendorReviews(vendor.userId);
      expect(result.data.length).toBe(0);
      expect(result.pagination.total).toBe(0);
    });

    it('filters reviews by rating', async () => {
      const vendor = await createVendor('review-v3');
      const product = await createProduct(vendor.userId);

      // Reviews don't require UserProfile
      await createReviewOnProduct(product.id, `${PREFIX}-buyer-r4`, 5);
      await createReviewOnProduct(product.id, `${PREFIX}-buyer-r5`, 2);

      const fiveStars = await vendorReviewService.getVendorReviews(vendor.userId, { rating: 5 });
      expect(fiveStars.data.length).toBe(1);
      expect(fiveStars.data[0].rating).toBe(5);
    });
  });

  // ─── Admin: List Vendors ────────────────────────────────────

  describe('admin vendor list', () => {
    it('lists all vendors with product count and earnings', async () => {
      const vendor1 = await createVendor('list-v1');
      const vendor2 = await createVendor('list-v2');
      await createProduct(vendor1.userId);
      await createProduct(vendor1.userId);
      await createProduct(vendor2.userId);

      const result = await adminVendorService.listVendors();

      // At least our two test vendors
      const ourVendors = result.data.filter((v: any) =>
        v.userId.startsWith(PREFIX),
      );
      expect(ourVendors.length).toBe(2);

      const v1 = ourVendors.find((v: any) => v.userId.includes('list-v1'));
      expect(v1.productCount).toBe(2);
    });

    it('filters vendors by status', async () => {
      await createVendor('status-active');
      const suspended = await createTestUser({
        userId: `${PREFIX}-vendor-status-susp`,
        isVendor: true,
        vendorStatus: 'SUSPENDED',
        storeName: `Suspended Store ${Date.now()}`,
        storeSlug: `${PREFIX}-store-susp-${Date.now()}`,
      });

      const result = await adminVendorService.listVendors({ status: 'SUSPENDED' });
      const ours = result.data.filter((v: any) => v.userId.startsWith(PREFIX));
      expect(ours.length).toBe(1);
      expect(ours[0].vendorStatus).toBe('SUSPENDED');
    });

    it('searches vendors by store name', async () => {
      await createVendor('search-vendorA');
      await createVendor('search-vendorB');

      const result = await adminVendorService.listVendors({
        search: 'search-vendorA',
      });

      const ours = result.data.filter((v: any) => v.userId.startsWith(PREFIX));
      expect(ours.length).toBe(1);
    });
  });

  // ─── Admin: Vendor Detail ──────────────────────────────────

  describe('admin vendor detail', () => {
    it('returns full vendor detail with stats', async () => {
      const vendor = await createVendor('detail-v1');
      const product = await createProduct(vendor.userId);
      // Use vendor's own userId as buyer (just need an order)
      await createOrder({
        vendorId: vendor.userId,
        buyerId: vendor.userId,
        productId: product.id,
        total: 5000,
      });

      const result = await adminVendorService.getVendorDetail(vendor.id);

      expect(result.storeName).toBe(`Test Store detail-v1`);
      expect(result.stats.productCount).toBe(1);
      expect(result.stats.orderCount).toBe(1);
      expect(result.recentOrders.length).toBe(1);
    });

    it('throws 404 for non-existent vendor', async () => {
      await expect(
        adminVendorService.getVendorDetail('000000000000000000000000'),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ─── Admin: Vendor Status Management ──────────────────────

  describe('admin vendor status', () => {
    it('suspends an active vendor', async () => {
      const vendor = await createVendor('suspend-v1');

      const result = await adminVendorService.updateVendorStatus(
        vendor.id,
        'SUSPENDED',
      );

      expect(result.vendorStatus).toBe('SUSPENDED');
    });

    it('bans a vendor', async () => {
      const vendor = await createVendor('ban-v1');

      const result = await adminVendorService.updateVendorStatus(
        vendor.id,
        'BANNED',
      );

      expect(result.vendorStatus).toBe('BANNED');
    });

    it('reactivates a suspended vendor', async () => {
      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-reactivate`,
        isVendor: true,
        vendorStatus: 'SUSPENDED',
        storeName: `Reactivate Store ${Date.now()}`,
        storeSlug: `${PREFIX}-store-reactivate-${Date.now()}`,
      });

      const result = await adminVendorService.updateVendorStatus(
        vendor.id,
        'ACTIVE',
      );

      expect(result.vendorStatus).toBe('ACTIVE');
    });

    it('reactivates a banned vendor', async () => {
      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-unban`,
        isVendor: true,
        vendorStatus: 'BANNED',
        storeName: `Unban Store ${Date.now()}`,
        storeSlug: `${PREFIX}-store-unban-${Date.now()}`,
      });

      const result = await adminVendorService.updateVendorStatus(
        vendor.id,
        'ACTIVE',
      );

      expect(result.vendorStatus).toBe('ACTIVE');
    });

    it('rejects setting same status', async () => {
      const vendor = await createVendor('same-status');

      await expect(
        adminVendorService.updateVendorStatus(vendor.id, 'ACTIVE'),
      ).rejects.toThrow(/already ACTIVE/i);
    });
  });

  // ─── Admin: Vendor Products ───────────────────────────────

  describe('admin vendor products', () => {
    it('lists products for a specific vendor', async () => {
      const vendor = await createVendor('prods-v1');
      await createProduct(vendor.userId);
      await createProduct(vendor.userId);

      const result = await adminVendorService.getVendorProducts(vendor.userId);

      expect(result.data.length).toBe(2);
      expect(result.pagination.total).toBe(2);
    });
  });

  // ─── Admin: Commission Report ─────────────────────────────

  describe('admin commission report', () => {
    it('returns per-vendor breakdown with platform totals', async () => {
      await seedCommissionRate('0.10');

      const vendor1 = await createVendor('report-v1');
      const vendor2 = await createVendor('report-v2');
      // Use vendor1's userId as buyer (a vendor can also be a customer)
      const buyerId = vendor1.userId;

      const product1 = await createProduct(vendor1.userId);
      const product2 = await createProduct(vendor2.userId);

      // Buyer buys from vendor2 (vendor1 buys from vendor2 as customer)
      const order1 = await createOrder({
        vendorId: vendor2.userId,
        buyerId,
        productId: product2.id,
        total: 10000,
      });
      // Create a second order for vendor1 with a unique buyer ID
      const order2 = await createOrder({
        vendorId: vendor1.userId,
        buyerId: vendor2.userId,
        productId: product1.id,
        total: 5000,
      });

      // Settle both orders
      await settleOrder(order1.id);
      await settleOrder(order2.id);

      const report = await getCommissionReport();

      expect(report.platform.totalOrders).toBeGreaterThanOrEqual(2);
      expect(report.platform.totalCommission).toBeGreaterThan(0);
      expect(report.vendors.length).toBeGreaterThanOrEqual(2);

      const v1 = report.vendors.find((v) => v.vendorId.includes('report-v1'));
      expect(v1).toBeDefined();
      expect(v1!.totalSales).toBeGreaterThan(0);
    });
  });

  // ─── Admin: Commission Settings ───────────────────────────

  describe('admin commission settings', () => {
    it('updates the commission rate', async () => {
      await seedCommissionRate('0.10');

      const result = await adminVendorService.updateCommissionRate(0.15);

      expect(result.value).toBe(0.15);

      // Verify persisted
      const stored = await adminVendorService.getCommissionRate();
      expect(stored.value).toBe(0.15);
    });

    it('rejects invalid commission rate', async () => {
      await expect(
        adminVendorService.updateCommissionRate(1.5),
      ).rejects.toThrow(/between 0 and 1/i);

      await expect(
        adminVendorService.updateCommissionRate(-0.1),
      ).rejects.toThrow(/between 0 and 1/i);
    });

    it('returns default rate when none set', async () => {
      const result = await adminVendorService.getCommissionRate();
      expect(result.value).toBe(0.10);
    });
  });
});
