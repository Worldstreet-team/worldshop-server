import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import {
  previewCheckoutSession,
  confirmCheckoutSession,
} from '../../services/checkout.service';
import { calculateShipping } from '../../types/cart.types';
import {
  initializePayment,
  handleWebhook,
  verifyPayment,
} from '../../services/payment.service';
import { OrderStatus, PaymentStatus } from '../../../generated/prisma';

const PREFIX = 'checkout-test';

async function cleanup() {
  // Clean up in dependency order
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

  await prisma.payment.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });
  await prisma.order.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { startsWith: PREFIX } } },
  });
  await prisma.cart.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });

  const products = await prisma.product.findMany({
    where: { vendorId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  if (productIds.length > 0) {
    await prisma.productVariant.deleteMany({
      where: { productId: { in: productIds } },
    });
  }

  await prisma.product.deleteMany({
    where: {
      OR: [
        { vendorId: { startsWith: PREFIX } },
        { slug: { startsWith: PREFIX } },
      ],
    },
  });
  await prisma.userProfile.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });
}

// Helper to create a product
let productCounter = 0;
async function createProduct(opts: {
  name: string;
  slug: string;
  vendorId?: string | null;
  price: number;
  stock?: number;
  type?: string;
}) {
  productCounter++;
  return prisma.product.create({
    data: {
      name: opts.name,
      slug: opts.slug,
      description: `${opts.name} description`,
      basePrice: opts.price,
      stock: opts.stock ?? 10,
      type: opts.type ?? 'PHYSICAL',
      isActive: true,
      vendorId: opts.vendorId ?? null,
      stockKeepingUnit: `${PREFIX}-SKU-${Date.now()}-${productCounter}`,
      tags: [],
      images: [],
    },
  });
}

// Helper to add item to cart
async function addToCart(userId: string, productId: string, quantity: number) {
  let cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId } });
  }
  await prisma.cartItem.create({
    data: { cartId: cart.id, productId, quantity },
  });
  return cart;
}

describe('checkout session service', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  // ─── Preview tests ──────────────────────────────────────────

  it('should preview a checkout session with vendor grouping', async () => {
    const buyer = await createTestUser({
      userId: `${PREFIX}-buyer1`,
    });
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor1`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Vendor One Store',
      storeSlug: 'vendor-one',
    });

    const platformProduct = await createProduct({
      name: 'Platform Item',
      slug: `${PREFIX}-platform-item`,
      vendorId: null,
      price: 5000,
      stock: 10,
    });
    const vendorProduct = await createProduct({
      name: 'Vendor Item',
      slug: `${PREFIX}-vendor-item`,
      vendorId: vendor.userId,
      price: 3000,
      stock: 5,
    });

    await addToCart(buyer.userId, platformProduct.id, 2);
    await addToCart(buyer.userId, vendorProduct.id, 1);

    const preview = await previewCheckoutSession(buyer.userId);

    expect(preview.vendorGroups).toHaveLength(2);
    expect(preview.issues).toHaveLength(0);
    expect(preview.snapshotToken).toBeTruthy();
    expect(preview.summary.orderCount).toBe(2);
    expect(preview.summary.subtotal).toBe(13000); // 5000*2 + 3000*1

    // Check vendor group
    const vendorGroup = preview.vendorGroups.find(
      (g) => g.vendorId === vendor.userId,
    );
    expect(vendorGroup).toBeDefined();
    expect(vendorGroup!.storeName).toBe('Vendor One Store');
    expect(vendorGroup!.items).toHaveLength(1);

    // Check platform group
    const platformGroup = preview.vendorGroups.find(
      (g) => g.vendorId === null,
    );
    expect(platformGroup).toBeDefined();
    expect(platformGroup!.storeName).toBe('WorldShop');
  });

  it('should detect stock issues in preview', async () => {
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer2` });
    const product = await createProduct({
      name: 'Low Stock Item',
      slug: `${PREFIX}-low-stock`,
      price: 1000,
      stock: 2,
    });

    await addToCart(buyer.userId, product.id, 5);

    const preview = await previewCheckoutSession(buyer.userId);

    expect(preview.issues).toHaveLength(1);
    expect(preview.issues[0].reason).toBe('INSUFFICIENT_STOCK');
    expect(preview.issues[0].productId).toBe(product.id);
  });

  it('should throw for empty cart', async () => {
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer3` });

    await expect(
      previewCheckoutSession(buyer.userId),
    ).rejects.toThrow('Your cart is empty');
  });

  // ─── Confirm tests ─────────────────────────────────────────

  it('should confirm checkout and create orders split by vendor', async () => {
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer4` });
    const vendor = await createTestUser({
      userId: `${PREFIX}-vendor2`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Vendor Two',
      storeSlug: 'vendor-two',
    });

    const p1 = await createProduct({
      name: 'Plat Product',
      slug: `${PREFIX}-plat-p`,
      vendorId: null,
      price: 10000,
      stock: 5,
    });
    const p2 = await createProduct({
      name: 'Vend Product',
      slug: `${PREFIX}-vend-p`,
      vendorId: vendor.userId,
      price: 8000,
      stock: 3,
    });

    await addToCart(buyer.userId, p1.id, 1);
    await addToCart(buyer.userId, p2.id, 2);

    // Preview first to get snapshotToken
    const preview = await previewCheckoutSession(buyer.userId);

    // Confirm
    const result = await confirmCheckoutSession(buyer.userId, {
      snapshotToken: preview.snapshotToken,
      shippingAddress: {
        firstName: 'Test',
        lastName: 'User',
        phone: '08012345678',
        street: '123 Test St',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        postalCode: '100001',
      },
    });

    expect(result.orders).toHaveLength(2);
    expect(result.checkoutSessionId).toBeTruthy();
    expect(result.summary.orderCount).toBe(2);

    // Verify orders in DB
    const dbOrders = await prisma.order.findMany({
      where: { checkoutSessionId: result.checkoutSessionId },
      include: { items: true },
    });
    expect(dbOrders).toHaveLength(2);

    // One should be platform, one vendor
    const vendorOrder = dbOrders.find((o) => o.vendorId === vendor.userId);
    const platformOrder = dbOrders.find((o) => o.vendorId === null);
    expect(vendorOrder).toBeDefined();
    expect(platformOrder).toBeDefined();
    expect(vendorOrder!.items).toHaveLength(1);
    expect(platformOrder!.items).toHaveLength(1);

    // Verify stock was decremented
    const updatedP1 = await prisma.product.findUnique({
      where: { id: p1.id },
    });
    const updatedP2 = await prisma.product.findUnique({
      where: { id: p2.id },
    });
    expect(updatedP1!.stock).toBe(4); // 5 - 1
    expect(updatedP2!.stock).toBe(1); // 3 - 2

    // Cart should be empty
    const cart = await prisma.cart.findUnique({
      where: { userId: buyer.userId },
      include: { items: true },
    });
    expect(cart!.items).toHaveLength(0);
  });

  it('should throw 409 if cart changed since preview', async () => {
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer5` });
    const product = await createProduct({
      name: 'Change Item',
      slug: `${PREFIX}-change`,
      price: 5000,
      stock: 10,
    });

    await addToCart(buyer.userId, product.id, 1);
    const preview = await previewCheckoutSession(buyer.userId);

    // Modify cart after preview
    const cart = await prisma.cart.findUnique({ where: { userId: buyer.userId } });
    await prisma.cartItem.updateMany({
      where: { cartId: cart!.id },
      data: { quantity: 3 },
    });

    try {
      await confirmCheckoutSession(buyer.userId, {
        snapshotToken: preview.snapshotToken,
        shippingAddress: {
          firstName: 'Test',
          lastName: 'User',
          phone: '08012345678',
          street: '123 Test St',
          city: 'Lagos',
          state: 'Lagos',
          country: 'Nigeria',
          postalCode: '100001',
        },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.preview).toBeDefined();
      expect(err.preview.snapshotToken).toBeTruthy();
    }
  });

  it('should handle digital-only checkout without shipping address', async () => {
    const buyer = await createTestUser({ userId: `${PREFIX}-buyer6` });
    const digitalProduct = await createProduct({
      name: 'Digital Item',
      slug: `${PREFIX}-digital`,
      price: 2000,
      type: 'DIGITAL',
    });

    await addToCart(buyer.userId, digitalProduct.id, 1);

    const preview = await previewCheckoutSession(buyer.userId);
    expect(preview.requiresShipping).toBe(false);

    const result = await confirmCheckoutSession(buyer.userId, {
      snapshotToken: preview.snapshotToken,
    });

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].shipping).toBe(0);
  });
});

describe('mock payment service', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  async function createCheckoutWithOrders() {
    const buyer = await createTestUser({
      userId: `${PREFIX}-pay-buyer`,
      email: `${PREFIX}-pay@test.com`,
    });
    const product = await createProduct({
      name: 'Pay Item',
      slug: `${PREFIX}-pay-item`,
      price: 10000,
      stock: 10,
    });

    await addToCart(buyer.userId, product.id, 1);

    const preview = await previewCheckoutSession(buyer.userId);
    const session = await confirmCheckoutSession(buyer.userId, {
      snapshotToken: preview.snapshotToken,
      shippingAddress: {
        firstName: 'Test',
        lastName: 'User',
        phone: '08012345678',
        street: '123 Test St',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        postalCode: '100001',
      },
    });

    return { buyer, session };
  }

  it('should initialize payment and return redirect URL', async () => {
    const { buyer, session } = await createCheckoutWithOrders();

    const result = await initializePayment(
      buyer.userId,
      buyer.email,
      session.checkoutSessionId,
    );

    expect(result.transactionRef).toMatch(/^WS-PAY-/);
    expect(result.action.type).toBe('redirect');
    if (result.action.type === 'redirect') {
      expect(result.action.url).toContain('/checkout/mock-payment');
      expect(result.action.url).toContain(session.checkoutSessionId);
    }

    // Check Payment record created
    const payment = await prisma.payment.findUnique({
      where: { checkoutSessionId: session.checkoutSessionId },
    });
    expect(payment).toBeTruthy();
    expect(payment!.status).toBe(PaymentStatus.PENDING);
    expect(payment!.provider).toBe('mock');
  });

  it('should confirm payment via webhook and mark orders PAID', async () => {
    const { buyer, session } = await createCheckoutWithOrders();

    await initializePayment(
      buyer.userId,
      buyer.email,
      session.checkoutSessionId,
    );

    const webhookResult = await handleWebhook(
      JSON.stringify({
        checkoutSessionId: session.checkoutSessionId,
        action: 'confirm',
      }),
      '',
    );

    expect(webhookResult.status).toBe('completed');

    // Verify payment updated
    const payment = await prisma.payment.findUnique({
      where: { checkoutSessionId: session.checkoutSessionId },
    });
    expect(payment!.status).toBe(PaymentStatus.COMPLETED);
    expect(payment!.paidAt).toBeTruthy();

    // Verify orders updated
    const orders = await prisma.order.findMany({
      where: { checkoutSessionId: session.checkoutSessionId },
    });
    for (const order of orders) {
      expect(order.status).toBe(OrderStatus.PAID);
      expect(order.paidAt).toBeTruthy();
    }
  });

  it('should decline payment via webhook and cancel orders', async () => {
    const { buyer, session } = await createCheckoutWithOrders();

    await initializePayment(
      buyer.userId,
      buyer.email,
      session.checkoutSessionId,
    );

    const webhookResult = await handleWebhook(
      JSON.stringify({
        checkoutSessionId: session.checkoutSessionId,
        action: 'decline',
      }),
      '',
    );

    expect(webhookResult.status).toBe('failed');

    // Verify payment
    const payment = await prisma.payment.findUnique({
      where: { checkoutSessionId: session.checkoutSessionId },
    });
    expect(payment!.status).toBe(PaymentStatus.FAILED);

    // Verify orders cancelled
    const orders = await prisma.order.findMany({
      where: { checkoutSessionId: session.checkoutSessionId },
    });
    for (const order of orders) {
      expect(order.status).toBe(OrderStatus.CANCELLED);
    }
  });

  it('should be idempotent on duplicate webhook', async () => {
    const { buyer, session } = await createCheckoutWithOrders();

    await initializePayment(
      buyer.userId,
      buyer.email,
      session.checkoutSessionId,
    );

    // First confirm
    await handleWebhook(
      JSON.stringify({
        checkoutSessionId: session.checkoutSessionId,
        action: 'confirm',
      }),
      '',
    );

    // Second confirm — should be idempotent
    const result = await handleWebhook(
      JSON.stringify({
        checkoutSessionId: session.checkoutSessionId,
        action: 'confirm',
      }),
      '',
    );

    expect(result.status).toBe('completed');
  });

  it('should verify payment status', async () => {
    const { buyer, session } = await createCheckoutWithOrders();

    const payResult = await initializePayment(
      buyer.userId,
      buyer.email,
      session.checkoutSessionId,
    );

    // Before webhook — pending
    const pendingResult = await verifyPayment(
      buyer.userId,
      payResult.transactionRef,
    );
    expect(pendingResult.status).toBe('pending');

    // After webhook confirm
    await handleWebhook(
      JSON.stringify({
        checkoutSessionId: session.checkoutSessionId,
        action: 'confirm',
      }),
      '',
    );

    const successResult = await verifyPayment(
      buyer.userId,
      payResult.transactionRef,
    );
    expect(successResult.status).toBe('success');
    expect(successResult.orders.length).toBeGreaterThan(0);
  });
});

describe('shipping calculation', () => {
  it('should apply flat rate for low subtotal', () => {
    expect(calculateShipping(10000)).toBe(2500);
  });

  it('should be free for subtotal >= 50000', () => {
    expect(calculateShipping(50000)).toBe(0);
    expect(calculateShipping(100000)).toBe(0);
  });
});
