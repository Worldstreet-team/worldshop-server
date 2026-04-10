import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import {
  getVendorOrders,
  getVendorOrder,
  updateVendorOrderStatus,
} from '../../services/vendor.order.service';
import { OrderStatus } from '../../../generated/prisma';

const PREFIX = 'vendor-orders-test';

async function cleanup() {
  // Find all test order IDs first
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { userId: { startsWith: PREFIX } },
        { vendorId: { startsWith: PREFIX } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);

  // Delete dependents first with individual deletes to avoid write conflicts
  if (orderIds.length > 0) {
    for (const id of orderIds) {
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { orderId: id } }).catch(() => {});
    }
    for (const id of orderIds) {
      await prisma.order.deleteMany({ where: { id } }).catch(() => {});
    }
  }

  await prisma.product.deleteMany({
    where: { vendorId: { startsWith: PREFIX } },
  }).catch(() => {});

  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  }).catch(() => {});
}

let productCounter = 0;

async function createProduct(vendorId: string, name: string, price: number) {
  productCounter++;
  return prisma.product.create({
    data: {
      name,
      slug: `${PREFIX}-${name.toLowerCase().replace(/\s+/g, '-')}-${productCounter}`,
      description: `${name} description`,
      basePrice: price,
      stock: 50,
      type: 'PHYSICAL',
      isActive: true,
      vendorId,
      stockKeepingUnit: `${PREFIX}-SKU-${Date.now()}-${productCounter}`,
      tags: [],
      images: [],
    },
  });
}

async function createOrder(
  userId: string,
  vendorId: string,
  product: { id: string; name: string; basePrice: number },
  status: OrderStatus = OrderStatus.PAID,
) {
  const total = product.basePrice;
  return prisma.order.create({
    data: {
      orderNumber: `WS-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      userId,
      vendorId,
      status,
      subtotal: total,
      shipping: 0,
      discount: 0,
      total,
      shippingAddress: {
        firstName: 'Test',
        lastName: 'Buyer',
        phone: '+1234567890',
        street: '123 Test St',
        city: 'Testville',
        state: 'TS',
        country: 'US',
        postalCode: '12345',
      },
      items: {
        create: {
          productId: product.id,
          productName: product.name,
          productImage: null,
          sku: null,
          variantName: null,
          quantity: 1,
          unitPrice: product.basePrice,
          totalPrice: total,
        },
      },
      statusHistory: {
        create: {
          status,
          note: `Created with status ${status}`,
        },
      },
    },
    include: {
      items: true,
      statusHistory: true,
    },
  });
}

describe('vendor order service', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  // ─── List vendor orders ─────────────────────────────────────

  it('should list only orders belonging to the vendor', async () => {
    const vendor1 = await createTestUser({
      userId: `${PREFIX}-vendor1`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Vendor One',
      storeSlug: 'vendor-one-orders',
    });
    const vendor2 = await createTestUser({
      userId: `${PREFIX}-vendor2`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Vendor Two',
      storeSlug: 'vendor-two-orders',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer1` });

    const product1 = await createProduct(vendor1.userId, 'V1 Product', 2000);
    const product2 = await createProduct(vendor2.userId, 'V2 Product', 3000);

    await createOrder(buyer.userId, vendor1.userId, product1);
    await createOrder(buyer.userId, vendor1.userId, product1);
    await createOrder(buyer.userId, vendor2.userId, product2);

    const result = await getVendorOrders(vendor1.userId, {
      page: 1,
      limit: 20,
      sortBy: 'newest',
    });

    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
    result.data.forEach((order) => {
      expect(order.vendorId).toBe(vendor1.userId);
    });
  });

  it('should filter vendor orders by status', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-filter`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Filter Vendor',
      storeSlug: 'filter-vendor',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-filter` });
    const product = await createProduct(vendor.userId, 'Filter Product', 1500);

    await createOrder(buyer.userId, vendor.userId, product, OrderStatus.PAID);
    await createOrder(buyer.userId, vendor.userId, product, OrderStatus.PROCESSING);
    await createOrder(buyer.userId, vendor.userId, product, OrderStatus.DELIVERED);

    const paidOnly = await getVendorOrders(vendor.userId, {
      page: 1,
      limit: 20,
      status: 'PAID',
      sortBy: 'newest',
    });

    expect(paidOnly.data).toHaveLength(1);
    expect(paidOnly.data[0].status).toBe(OrderStatus.PAID);
  });

  it('should paginate vendor orders', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-page`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Page Vendor',
      storeSlug: 'page-vendor',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-page` });
    const product = await createProduct(vendor.userId, 'Page Product', 1000);

    for (let i = 0; i < 5; i++) {
      await createOrder(buyer.userId, vendor.userId, product);
    }

    const page1 = await getVendorOrders(vendor.userId, {
      page: 1,
      limit: 2,
      sortBy: 'newest',
    });

    expect(page1.data).toHaveLength(2);
    expect(page1.pagination.total).toBe(5);
    expect(page1.pagination.totalPages).toBe(3);

    const page2 = await getVendorOrders(vendor.userId, {
      page: 2,
      limit: 2,
      sortBy: 'newest',
    });

    expect(page2.data).toHaveLength(2);
  });

  // ─── Get single vendor order ────────────────────────────────

  it('should return order detail for vendor-owned order', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-detail`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Detail Vendor',
      storeSlug: 'detail-vendor',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-detail` });
    const product = await createProduct(vendor.userId, 'Detail Product', 4500);

    const order = await createOrder(buyer.userId, vendor.userId, product);

    const result = await getVendorOrder(order.id, vendor.userId);

    expect(result.id).toBe(order.id);
    expect(result.vendorId).toBe(vendor.userId);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productName).toBe('Detail Product');
    expect(result.statusHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject access to another vendor\'s order', async () => {
    const vendor1 = await createTestUser({
      userId: `${PREFIX}-vendor-own1`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Owner Vendor',
      storeSlug: 'owner-vendor',
    });
    const vendor2 = await createTestUser({
      userId: `${PREFIX}-vendor-own2`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Other Vendor',
      storeSlug: 'other-vendor',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-own` });
    const product = await createProduct(vendor1.userId, 'Own Product', 2000);

    const order = await createOrder(buyer.userId, vendor1.userId, product);

    await expect(
      getVendorOrder(order.id, vendor2.userId),
    ).rejects.toThrow(/Not authorized/);
  });

  it('should return 404 for non-existent order', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-404`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: '404 Vendor',
      storeSlug: 'vendor-404',
    });

    await expect(
      getVendorOrder('000000000000000000000000', vendor.userId),
    ).rejects.toThrow(/not found/i);
  });

  // ─── Status transitions ─────────────────────────────────────

  it('should allow PAID → PROCESSING transition', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-trans1`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Trans Vendor',
      storeSlug: 'trans-vendor-1',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-trans1` });
    const product = await createProduct(vendor.userId, 'Trans Product 1', 3000);

    const order = await createOrder(buyer.userId, vendor.userId, product, OrderStatus.PAID);

    const updated = await updateVendorOrderStatus(order.id, vendor.userId, {
      status: 'PROCESSING',
      note: 'Started packing',
    });

    expect(updated.status).toBe(OrderStatus.PROCESSING);
    expect(updated.statusHistory[0].status).toBe(OrderStatus.PROCESSING);
    expect(updated.statusHistory[0].note).toBe('Started packing');
  });

  it('should allow PROCESSING → DELIVERED transition and set deliveredAt', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-trans2`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Trans Vendor 2',
      storeSlug: 'trans-vendor-2',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-trans2` });
    const product = await createProduct(vendor.userId, 'Trans Product 2', 2500);

    const order = await createOrder(buyer.userId, vendor.userId, product, OrderStatus.PROCESSING);

    const updated = await updateVendorOrderStatus(order.id, vendor.userId, {
      status: 'DELIVERED',
    });

    expect(updated.status).toBe(OrderStatus.DELIVERED);
    expect(updated.deliveredAt).toBeTruthy();
  });

  it('should reject invalid transition PAID → DELIVERED', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-trans3`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Trans Vendor 3',
      storeSlug: 'trans-vendor-3',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-trans3` });
    const product = await createProduct(vendor.userId, 'Trans Product 3', 1800);

    const order = await createOrder(buyer.userId, vendor.userId, product, OrderStatus.PAID);

    await expect(
      updateVendorOrderStatus(order.id, vendor.userId, { status: 'DELIVERED' }),
    ).rejects.toThrow(/Cannot transition/);
  });

  it('should reject vendor updating another vendor\'s order status', async () => {
    const vendor1 = await createTestUser({
      userId: `${PREFIX}-vendor-auth1`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Auth Vendor 1',
      storeSlug: 'auth-vendor-1',
    });
    const vendor2 = await createTestUser({
      userId: `${PREFIX}-vendor-auth2`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Auth Vendor 2',
      storeSlug: 'auth-vendor-2',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-auth` });
    const product = await createProduct(vendor1.userId, 'Auth Product', 2000);

    const order = await createOrder(buyer.userId, vendor1.userId, product, OrderStatus.PAID);

    await expect(
      updateVendorOrderStatus(order.id, vendor2.userId, { status: 'PROCESSING' }),
    ).rejects.toThrow(/Not authorized/);
  });

  it('should reject transition from terminal state DELIVERED', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-term`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Term Vendor',
      storeSlug: 'term-vendor',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-term` });
    const product = await createProduct(vendor.userId, 'Term Product', 1500);

    const order = await createOrder(buyer.userId, vendor.userId, product, OrderStatus.DELIVERED);

    await expect(
      updateVendorOrderStatus(order.id, vendor.userId, { status: 'PROCESSING' }),
    ).rejects.toThrow(/Cannot transition/);
  });

  it('should support full lifecycle PAID → PROCESSING → DELIVERED', async () => {
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor-lifecycle`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Lifecycle Vendor',
      storeSlug: 'lifecycle-vendor',
    });
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer-lifecycle` });
    const product = await createProduct(vendor.userId, 'Lifecycle Product', 5000);

    const order = await createOrder(buyer.userId, vendor.userId, product, OrderStatus.PAID);

    // PAID → PROCESSING
    const processing = await updateVendorOrderStatus(order.id, vendor.userId, {
      status: 'PROCESSING',
      note: 'Preparing order',
    });
    expect(processing.status).toBe(OrderStatus.PROCESSING);

    // PROCESSING → DELIVERED
    const delivered = await updateVendorOrderStatus(order.id, vendor.userId, {
      status: 'DELIVERED',
      note: 'Order fulfilled',
    });
    expect(delivered.status).toBe(OrderStatus.DELIVERED);
    expect(delivered.deliveredAt).toBeTruthy();
    expect(delivered.statusHistory.length).toBeGreaterThanOrEqual(3);
  });
});
