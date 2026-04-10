import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import { settleOrder } from '../../services/ledger.write.service';
import {
  getVendorBalance,
  getVendorLedger,
  getVendorAnalytics,
  getCommissionReport,
} from '../../services/ledger.read.service';
import { OrderStatus, LedgerEntryType } from '../../../generated/prisma';

const PREFIX = 'ledger-test';

// ─── Helpers ────────────────────────────────────────────────────

async function cleanup() {
  await prisma.ledgerEntry.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  });
  await prisma.vendorBalance.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  });

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
  await prisma.product.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  });
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });
  await prisma.platformConfig.deleteMany({
    where: { key: 'commissionRate' },
  });
}

let productCounter = 0;
async function createVendorOrder(opts: {
  vendorId: string;
  buyerId: string;
  total: number;
  status?: OrderStatus;
}) {
  productCounter++;
  const product = await prisma.product.create({
    data: {
      name: `Ledger Test Product ${productCounter}`,
      slug: `${PREFIX}-product-${Date.now()}-${productCounter}`,
      description: 'Test product',
      basePrice: opts.total,
      type: 'DIGITAL',
      isActive: true,
      vendorId: opts.vendorId,
      stockKeepingUnit: `${PREFIX}-SKU-${Date.now()}-${productCounter}`,
      tags: [],
      images: [],
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: `${PREFIX}-ORD-${Date.now()}-${productCounter}`,
      userId: opts.buyerId,
      vendorId: opts.vendorId,
      status: opts.status ?? OrderStatus.PAID,
      subtotal: opts.total,
      total: opts.total,
      items: {
        create: {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: opts.total,
          totalPrice: opts.total,
        },
      },
      statusHistory: {
        create: {
          status: opts.status ?? OrderStatus.PAID,
          note: 'Test order',
        },
      },
    },
  });

  return order;
}

async function seedCommissionRate(rate: string = '0.10') {
  await prisma.platformConfig.upsert({
    where: { key: 'commissionRate' },
    update: { value: rate },
    create: { key: 'commissionRate', value: rate },
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('platform ledger & vendor earnings', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  // ─── settleOrder ──────────────────────────────────────────────

  describe('settleOrder', () => {
    it('creates SALE + COMMISSION entries and updates vendor balance', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-1`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Ledger Test Store',
        storeSlug: 'ledger-test-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-1`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 10000,
      });

      const result = await settleOrder(order.id);

      expect(result.wasAlreadySettled).toBe(false);
      expect(result.orderId).toBe(order.id);
      expect(result.vendorId).toBe(vendor.userId);
      expect(result.grossSale).toBe(10000);
      expect(result.commission).toBe(1000); // 10%
      expect(result.vendorNet).toBe(9000);  // 90%
      expect(result.newAvailableBalance).toBe(9000);

      // Verify ledger entries
      const saleEntry = await prisma.ledgerEntry.findFirst({
        where: { orderId: order.id, type: LedgerEntryType.SALE },
      });
      expect(saleEntry).toBeTruthy();
      expect(saleEntry!.amount).toBe(9000);
      expect(saleEntry!.balanceBefore).toBe(0);
      expect(saleEntry!.balanceAfter).toBe(9000);

      const commEntry = await prisma.ledgerEntry.findFirst({
        where: { orderId: order.id, type: LedgerEntryType.COMMISSION },
      });
      expect(commEntry).toBeTruthy();
      expect(commEntry!.amount).toBe(1000);

      // Verify vendor balance
      const balance = await prisma.vendorBalance.findUnique({
        where: { vendorId: vendor.userId },
      });
      expect(balance).toBeTruthy();
      expect(balance!.availableBalance).toBe(9000);
      expect(balance!.totalEarned).toBe(9000);
      expect(balance!.totalCommission).toBe(1000);
    });

    it('is idempotent — duplicate calls return wasAlreadySettled', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-2`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Idempotent Store',
        storeSlug: 'idempotent-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-2`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 5000,
      });

      const first = await settleOrder(order.id);
      expect(first.wasAlreadySettled).toBe(false);

      const second = await settleOrder(order.id);
      expect(second.wasAlreadySettled).toBe(true);
      expect(second.vendorNet).toBe(4500);

      // No duplicate entries
      const entries = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id },
      });
      expect(entries).toHaveLength(2); // 1 SALE + 1 COMMISSION
    });

    it('reads commission rate from PlatformConfig', async () => {
      await seedCommissionRate('0.15'); // 15% commission

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-3`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Rate Test Store',
        storeSlug: 'rate-test-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-3`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 20000,
      });

      const result = await settleOrder(order.id);

      expect(result.commission).toBe(3000); // 15% of 20000
      expect(result.vendorNet).toBe(17000); // 85%
    });

    it('rejects non-PAID orders', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-4`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Status Check Store',
        storeSlug: 'status-check-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-4`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 1000,
        status: OrderStatus.CREATED,
      });

      await expect(settleOrder(order.id)).rejects.toThrow(/not in PAID status/);
    });

    it('rejects platform-owned orders', async () => {
      await seedCommissionRate('0.10');

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-5`,
      });

      // Platform order (no vendorId)
      const order = await prisma.order.create({
        data: {
          orderNumber: `${PREFIX}-ORD-PLATFORM-${Date.now()}`,
          userId: buyer.userId,
          status: OrderStatus.PAID,
          subtotal: 5000,
          total: 5000,
          statusHistory: {
            create: { status: OrderStatus.PAID, note: 'Test' },
          },
        },
      });

      await expect(settleOrder(order.id)).rejects.toThrow(/platform-owned/);
    });

    it('accumulates balance across multiple orders', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-6`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Multi Order Store',
        storeSlug: 'multi-order-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-6`,
      });

      const order1 = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 10000,
      });

      const order2 = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 20000,
      });

      const result1 = await settleOrder(order1.id);
      expect(result1.newAvailableBalance).toBe(9000);

      const result2 = await settleOrder(order2.id);
      expect(result2.newAvailableBalance).toBe(27000); // 9000 + 18000

      const balance = await prisma.vendorBalance.findUnique({
        where: { vendorId: vendor.userId },
      });
      expect(balance!.availableBalance).toBe(27000);
      expect(balance!.totalEarned).toBe(27000);
      expect(balance!.totalCommission).toBe(3000); // 1000 + 2000
    });
  });

  // ─── Read services ────────────────────────────────────────────

  describe('getVendorBalance', () => {
    it('returns zero balance for vendor with no sales', async () => {
      const balance = await getVendorBalance(`${PREFIX}-no-sales`);

      expect(balance.vendorId).toBe(`${PREFIX}-no-sales`);
      expect(balance.availableBalance).toBe(0);
      expect(balance.totalEarned).toBe(0);
      expect(balance.totalCommission).toBe(0);
    });
  });

  describe('getVendorLedger', () => {
    it('returns paginated ledger entries', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-ledger`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Ledger Query Store',
        storeSlug: 'ledger-query-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-ledger`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 8000,
      });

      await settleOrder(order.id);

      const result = await getVendorLedger(vendor.userId);

      expect(result.total).toBe(2); // SALE + COMMISSION
      expect(result.entries).toHaveLength(2);
    });

    it('filters by type', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-filter`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Filter Store',
        storeSlug: 'filter-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-filter`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 6000,
      });

      await settleOrder(order.id);

      const sales = await getVendorLedger(vendor.userId, { type: 'SALE' });
      expect(sales.total).toBe(1);
      expect(sales.entries[0].type).toBe(LedgerEntryType.SALE);

      const commissions = await getVendorLedger(vendor.userId, { type: 'COMMISSION' });
      expect(commissions.total).toBe(1);
      expect(commissions.entries[0].type).toBe(LedgerEntryType.COMMISSION);
    });
  });

  describe('getVendorAnalytics', () => {
    it('returns analytics summary for a vendor', async () => {
      await seedCommissionRate('0.10');

      const vendor = await createTestUser({
        userId: `${PREFIX}-vendor-analytics`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Analytics Store',
        storeSlug: 'analytics-store',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-analytics`,
      });

      const order = await createVendorOrder({
        vendorId: vendor.userId,
        buyerId: buyer.userId,
        total: 15000,
      });

      await settleOrder(order.id);

      const analytics = await getVendorAnalytics({ vendorId: vendor.userId });

      expect(analytics.vendorId).toBe(vendor.userId);
      expect(analytics.summary.totalOrders).toBe(1);
      expect(analytics.summary.totalSales).toBe(15000);
      expect(analytics.summary.totalCommission).toBe(1500);
      expect(analytics.summary.netRevenue).toBe(13500);
      expect(analytics.balance.availableBalance).toBe(13500);
      expect(analytics.earningsOverTime.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getCommissionReport', () => {
    it('returns platform-wide commission report', async () => {
      await seedCommissionRate('0.10');

      const vendor1 = await createTestUser({
        userId: `${PREFIX}-vendor-report-1`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Report Store 1',
        storeSlug: 'report-store-1',
      });

      const vendor2 = await createTestUser({
        userId: `${PREFIX}-vendor-report-2`,
        isVendor: true,
        vendorStatus: 'ACTIVE',
        storeName: 'Report Store 2',
        storeSlug: 'report-store-2',
      });

      const buyer = await createTestUser({
        userId: `${PREFIX}-buyer-report`,
      });

      const order1 = await createVendorOrder({
        vendorId: vendor1.userId,
        buyerId: buyer.userId,
        total: 10000,
      });

      const order2 = await createVendorOrder({
        vendorId: vendor2.userId,
        buyerId: buyer.userId,
        total: 20000,
      });

      await settleOrder(order1.id);
      await settleOrder(order2.id);

      const report = await getCommissionReport();

      expect(report.platform.totalOrders).toBe(2);
      expect(report.platform.totalSales).toBe(30000);
      expect(report.platform.totalCommission).toBe(3000);
      expect(report.platform.netToVendors).toBe(27000);
      expect(report.platform.commissionRate).toBe(0.10);
      expect(report.vendors).toHaveLength(2);

      // Sorted by totalSales descending
      expect(report.vendors[0].totalSales).toBe(20000);
      expect(report.vendors[1].totalSales).toBe(10000);
    });
  });
});
