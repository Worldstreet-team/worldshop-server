import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { createHash, randomUUID } from 'crypto';
import { OrderStatus, PaymentProvider, PaymentStatus } from '../../generated/prisma';
import { getWalletHold, releaseWalletHold } from './payment/providers/wallet.provider';
import type {
  CheckoutIssue,
  VendorGroup,
  CheckoutSessionPreview,
  CheckoutSessionResult,
  ConfirmCheckoutSessionInput,
  ShippingAddress,
} from '../types/order.types';
import { signR2Key } from '../utils/signUrl';
import { calculateShipping } from '../types/cart.types';
import { globalLog as logger } from '../configs/loggerConfig';
import { assertProductPurchasable } from './product-eligibility.service';

const CHECKOUT_RESERVATION_MINUTES = Number(
  process.env.CHECKOUT_RESERVATION_MINUTES || 60,
);

export function isDigitalOnlyCart(
  items: Array<{ product: { type?: string } }>,
): boolean {
  return items.every((item) => item.product.type === 'DIGITAL');
}

/**
 * Unwind the wallet hold behind an abandoned checkout session, so its funds go
 * back to the buyer before the orders are cancelled.
 *
 * Returns whether it is SAFE to cancel the session's orders. It is not safe
 * when the money already moved (a captured hold) or when the wallet cannot be
 * reached to find out — cancelling then would leave the buyer paying for
 * nothing. In those cases the session is left alone and retried next sweep.
 */
export async function unwindWalletHoldForSession(checkoutSessionId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({ where: { checkoutSessionId } });

  // Nothing was ever authorized against the wallet — cancel freely.
  if (!payment || payment.provider !== PaymentProvider.WALLET) return true;
  if (payment.status === PaymentStatus.FAILED) return true;
  if (!payment.transactionRef) return true;

  if (payment.status === PaymentStatus.COMPLETED) {
    logger.error('[Checkout] Refusing to cancel a PAID session', {
      checkoutSessionId,
      reason: 'payment already completed but orders are still CREATED',
    });
    return false;
  }

  const hold = await getWalletHold(payment.transactionRef);
  if (!hold) {
    logger.warn('[Checkout] Wallet unreachable — leaving session for the next sweep', {
      checkoutSessionId,
    });
    return false;
  }

  if (hold.status === 'captured') {
    // The buyer paid but the order was never settled (a crash between capture
    // and markPaymentCompleted). Cancelling now would take their money for
    // nothing. Leave it and shout — settlement or a refund needs a human.
    logger.error('[Checkout] Wallet hold already CAPTURED for an unsettled session', {
      checkoutSessionId,
      transactionRef: payment.transactionRef,
      action: 'orders left CREATED — settle or refund manually',
    });
    return false;
  }

  if (hold.status === 'held' && !(await releaseWalletHold(payment.transactionRef, 'checkout expired'))) {
    logger.error('[Checkout] Could not release hold — leaving session intact', {
      checkoutSessionId,
    });
    return false;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.FAILED },
  });
  return true;
}

export async function releaseExpiredCheckoutSessions(
  reservationMinutes = CHECKOUT_RESERVATION_MINUTES,
): Promise<number> {
  const cutoff = new Date(Date.now() - reservationMinutes * 60 * 1000);
  const expiredOrders = await prisma.order.findMany({
    where: {
      status: OrderStatus.CREATED,
      checkoutSessionId: { not: null },
      createdAt: { lt: cutoff },
    },
    select: { checkoutSessionId: true },
    take: 200,
  });

  const checkoutSessionIds = [
    ...new Set(
      expiredOrders
        .map((order) => order.checkoutSessionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  let releasedCount = 0;

  for (const checkoutSessionId of checkoutSessionIds) {
    try {
      // A wallet payment locks the buyer's funds in a hold before the orders
      // are payable. Unwind that hold before cancelling, and never cancel a
      // session whose money was already captured — that would take payment for
      // an order the buyer no longer has.
      const unwound = await unwindWalletHoldForSession(checkoutSessionId);
      if (!unwound) continue;

      releasedCount += await prisma.$transaction(async (tx) => {
        const orders = await tx.order.findMany({
          where: { checkoutSessionId, status: OrderStatus.CREATED },
          include: {
            items: {
              include: { product: { select: { type: true } } },
            },
          },
        });

        let sessionReleased = 0;

        for (const order of orders) {
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: OrderStatus.CREATED },
            data: { status: OrderStatus.CANCELLED },
          });

          if (updated.count === 0) continue;

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
              note: 'Payment window expired',
            },
          });

          for (const item of order.items) {
            if (item.product.type === 'DIGITAL') continue;
            if (item.variantId) {
              await tx.productVariant.update({
                where: { id: item.variantId },
                data: { stock: { increment: item.quantity } },
              });
            } else {
              await tx.product.update({
                where: { id: item.productId },
                data: { stock: { increment: item.quantity } },
              });
            }
          }

          sessionReleased += 1;
        }

        return sessionReleased;
      });
    } catch (err) {
      logger.error('[Checkout] Failed to release expired reservation', {
        checkoutSessionId,
        error: (err as Error).message,
      });
    }
  }

  return releasedCount;
}

// ─── Validate cart (kept for backward compat) ───────────────────

export async function validateCart(userId: string) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: { product: true, variant: true },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    return { valid: false, issues: ['Your cart is empty'] };
  }

  const issues: string[] = [];
  const validatedItems: Array<{
    productId: string;
    productName: string;
    quantity: number;
    available: number;
    price: number;
  }> = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const availableStock = item.variant?.stock ?? item.product.stock;
    const price =
      item.variant?.price ?? item.product.salePrice ?? item.product.basePrice;

    try {
      await assertProductPurchasable(item.product);
    } catch (err) {
      issues.push((err as Error).message);
      continue;
    }

    if (item.product.type !== 'DIGITAL' && availableStock < item.quantity) {
      if (availableStock === 0) {
        issues.push(`${item.product.name} is out of stock`);
      } else {
        issues.push(
          `Only ${availableStock} of ${item.product.name} available (you have ${item.quantity} in cart)`,
        );
      }
    }

    validatedItems.push({
      productId: item.productId,
      productName: item.product.name,
      quantity: item.quantity,
      available: availableStock,
      price,
    });

    subtotal += price * Math.min(item.quantity, availableStock);
  }

  const digitalOnly = isDigitalOnlyCart(cart.items);
  const shipping = digitalOnly ? 0 : calculateShipping(subtotal);
  const total = subtotal + shipping;

  return {
    valid: issues.length === 0,
    issues,
    cart: { items: validatedItems, subtotal, shipping, total },
  };
}

// ─── Cart item type with full product/variant includes ──────────

type CartItemWithProduct = {
  id: string;
  cartId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  product: {
    id: string;
    name: string;
    slug: string;
    type: string;
    basePrice: number;
    salePrice: number | null;
    stock: number;
    isActive: boolean;
    approvalStatus: string;
    vendorId: string | null;
    images: unknown;
    stockKeepingUnit: string | null;
  };
  variant: {
    id: string;
    name: string;
    price: number | null;
    stock: number;
    isActive: boolean;
    stockKeepingUnit: string | null;
  } | null;
};

// ─── Snapshot token ─────────────────────────────────────────────

function computeSnapshotToken(
  items: CartItemWithProduct[],
): string {
  // Hash of item ids, quantities, prices, and stock to detect changes
  const data = items
    .map((item) => {
      const price =
        item.variant?.price ?? item.product.salePrice ?? item.product.basePrice;
      const stock = item.variant?.stock ?? item.product.stock;
      return `${item.productId}:${item.variantId || ''}:${item.quantity}:${price}:${stock}:${item.product.isActive}:${item.product.approvalStatus}`;
    })
    .sort()
    .join('|');
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

// ─── Group items by vendor ──────────────────────────────────────

async function groupItemsByVendor(
  items: CartItemWithProduct[],
): Promise<VendorGroup[]> {
  // Collect unique vendor IDs (null for platform-owned)
  const vendorIds = [
    ...new Set(items.map((item) => item.product.vendorId).filter(Boolean)),
  ] as string[];

  // Batch-fetch vendor profiles
  const vendorProfiles =
    vendorIds.length > 0
      ? await prisma.userProfile.findMany({
          where: { userId: { in: vendorIds }, isVendor: true },
          select: { userId: true, storeName: true },
        })
      : [];

  const vendorNameMap = new Map<string, string>();
  for (const v of vendorProfiles) {
    vendorNameMap.set(v.userId, v.storeName || 'Unknown Store');
  }

  // Group items
  const groupMap = new Map<string | null, CartItemWithProduct[]>();
  for (const item of items) {
    const key = item.product.vendorId;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }

  const groups: VendorGroup[] = [];

  for (const [vendorId, groupItems] of groupMap) {
    const storeName = vendorId
      ? vendorNameMap.get(vendorId) || 'Unknown Store'
      : 'WorldShop';

    const vendorItems = await Promise.all(
      groupItems.map(async (item) => {
        const price =
          item.variant?.price ??
          item.product.salePrice ??
          item.product.basePrice;

        let primaryImage: string | null = null;
        try {
          const images = Array.isArray(item.product.images)
            ? item.product.images
            : JSON.parse(item.product.images as string);
          const primary = images.find(
            (img: { isPrimary?: boolean }) => img.isPrimary,
          );
          const bestImg = primary || images[0];
          const imgKey =
            (bestImg?.cloudflareId as string) || bestImg?.url || null;
          primaryImage = imgKey ? await signR2Key(imgKey) : null;
        } catch {
          // No images
        }

        return {
          productId: item.productId,
          variantId: item.variantId,
          productName: item.product.name,
          image: primaryImage,
          variantName: item.variant?.name || null,
          quantity: item.quantity,
          unitPrice: price,
          totalPrice: price * item.quantity,
          type: item.product.type,
        };
      }),
    );

    const subtotal = vendorItems.reduce((s, i) => s + i.totalPrice, 0);
    const allDigital = vendorItems.every((i) => i.type === 'DIGITAL');
    const shipping = allDigital ? 0 : calculateShipping(subtotal);

    groups.push({
      vendorId: vendorId || null,
      storeName,
      items: vendorItems,
      subtotal,
      shipping,
      total: subtotal + shipping,
    });
  }

  return groups;
}

// ─── Preview checkout session ───────────────────────────────────

export async function previewCheckoutSession(
  userId: string,
): Promise<CheckoutSessionPreview> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: { product: true, variant: true },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw createError(400, 'Your cart is empty');
  }

  const items = cart.items as unknown as CartItemWithProduct[];
  const issues: CheckoutIssue[] = [];

  // Validate each item
  for (const item of items) {
    try {
      await assertProductPurchasable(item.product);
    } catch (err) {
      issues.push({
        productId: item.productId,
        productName: item.product.name,
        reason: 'INACTIVE',
        detail: (err as Error).message,
      });
      continue;
    }

    if (item.product.type !== 'DIGITAL') {
      const stock = item.variant?.stock ?? item.product.stock;
      if (stock === 0) {
        issues.push({
          productId: item.productId,
          productName: item.product.name,
          reason: 'OUT_OF_STOCK',
          detail: `${item.product.name} is out of stock`,
        });
      } else if (stock < item.quantity) {
        issues.push({
          productId: item.productId,
          productName: item.product.name,
          reason: 'INSUFFICIENT_STOCK',
          detail: `Only ${stock} of ${item.product.name} available (you have ${item.quantity} in cart)`,
        });
      }
    }
  }

  const snapshotToken = computeSnapshotToken(items);
  const vendorGroups = await groupItemsByVendor(items);

  const requiresShipping = !isDigitalOnlyCart(items);

  const subtotal = vendorGroups.reduce((s, g) => s + g.subtotal, 0);
  const shipping = vendorGroups.reduce((s, g) => s + g.shipping, 0);
  const total = subtotal + shipping;
  const itemCount = vendorGroups.reduce(
    (count, g) => count + g.items.reduce((c, i) => c + i.quantity, 0),
    0,
  );

  return {
    snapshotToken,
    vendorGroups,
    issues,
    requiresShipping,
    summary: {
      orderCount: vendorGroups.length,
      subtotal,
      shipping,
      discount: 0,
      total,
      itemCount,
    },
  };
}

// ─── Confirm checkout session ───────────────────────────────────

function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `WS-${dateStr}-${random}`;
}

export async function confirmCheckoutSession(
  userId: string,
  input: ConfirmCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: { product: true, variant: true },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw createError(400, 'Your cart is empty');
  }

  const items = cart.items as unknown as CartItemWithProduct[];

  // Verify snapshot hasn't changed
  const currentToken = computeSnapshotToken(items);
  if (currentToken !== input.snapshotToken) {
    // Cart changed — return 409 with fresh preview
    const freshPreview = await previewCheckoutSession(userId);
    const err = createError(409, 'Cart has changed since preview');
    (err as any).preview = freshPreview;
    throw err;
  }

  // Group items by vendor (before transaction — read-only)
  const vendorIds = [
    ...new Set(items.map((i) => i.product.vendorId).filter(Boolean)),
  ] as string[];

  const vendorProfiles =
    vendorIds.length > 0
      ? await prisma.userProfile.findMany({
          where: { userId: { in: vendorIds }, isVendor: true },
          select: { userId: true, storeName: true },
        })
      : [];

  const vendorNameMap = new Map<string, string>();
  for (const v of vendorProfiles) {
    vendorNameMap.set(v.userId, v.storeName || 'Unknown Store');
  }

  const groupMap = new Map<string | null, CartItemWithProduct[]>();
  for (const item of items) {
    const key = item.product.vendorId;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }

  const checkoutSessionId = randomUUID();
  const digitalOnly = isDigitalOnlyCart(items);

  // Determine shipping address
  const shippingAddress = digitalOnly
    ? undefined
    : (input.shippingAddress as object);

  if (!digitalOnly && !shippingAddress) {
    throw createError(400, 'Shipping address is required for physical orders');
  }

  // C2 FIX: Validate stock AND decrement INSIDE the same transaction
  const createdOrders = await prisma.$transaction(async (tx) => {
    // Re-validate stock/availability inside the transaction
    for (const item of items) {
      await assertProductPurchasable(item.product);
      if (item.product.type !== 'DIGITAL') {
        // Read fresh stock inside transaction to prevent race
        let currentStock: number;
        if (item.variantId) {
          const freshVariant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            select: { stock: true },
          });
          currentStock = freshVariant?.stock ?? 0;
        } else {
          const freshProduct = await tx.product.findUnique({
            where: { id: item.productId },
            select: { stock: true },
          });
          currentStock = freshProduct?.stock ?? 0;
        }
        if (currentStock < item.quantity) {
          throw createError(
            400,
            `Only ${currentStock} of ${item.product.name} available`,
          );
        }
      }
    }
    const orders: Array<{
      id: string;
      orderNumber: string;
      vendorId: string | null;
      storeName: string;
      subtotal: number;
      shipping: number;
      total: number;
      itemCount: number;
    }> = [];

    for (const [vendorId, groupItems] of groupMap) {
      const storeName = vendorId
        ? vendorNameMap.get(vendorId) || 'Unknown Store'
        : 'WorldShop';

      // Build order items with price snapshots
      const orderItems: Array<{
        productId: string;
        variantId: string | null;
        productName: string;
        productImage: string | null;
        sku: string | null;
        variantName: string | null;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
      }> = [];

      for (const item of groupItems) {
        const price =
          item.variant?.price ??
          item.product.salePrice ??
          item.product.basePrice;

        let primaryImage: string | null = null;
        try {
          const images = Array.isArray(item.product.images)
            ? item.product.images
            : JSON.parse(item.product.images as string);
          const primary = images.find(
            (img: { isPrimary?: boolean }) => img.isPrimary,
          );
          const bestImg = primary || images[0];
          primaryImage =
            (bestImg?.cloudflareId as string) || bestImg?.url || null;
        } catch {
          // No images
        }

        orderItems.push({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.product.name,
          productImage: primaryImage,
          sku:
            item.variant?.stockKeepingUnit ??
            item.product.stockKeepingUnit ??
            null,
          variantName: item.variant?.name ?? null,
          quantity: item.quantity,
          unitPrice: price,
          totalPrice: price * item.quantity,
        });
      }

      const subtotal = orderItems.reduce((s, i) => s + i.totalPrice, 0);
      const groupDigitalOnly = groupItems.every(
        (i) => i.product.type === 'DIGITAL',
      );
      const shipping = groupDigitalOnly ? 0 : calculateShipping(subtotal);
      const total = subtotal + shipping;

      const newOrder = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId,
          vendorId: vendorId || null,
          checkoutSessionId,
          status: OrderStatus.CREATED,
          shippingAddress: groupDigitalOnly ? undefined : shippingAddress,
          billingAddress: input.billingAddress as object | undefined,
          notes: input.notes,
          subtotal,
          shipping,
          discount: 0,
          total,
          items: { create: orderItems },
          statusHistory: {
            create: {
              status: OrderStatus.CREATED,
              note: 'Order placed',
            },
          },
        },
      });

      // Decrement stock for physical products
      for (const item of groupItems) {
        if (item.product.type === 'DIGITAL') continue;
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { decrement: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
        }
      }

      orders.push({
        id: newOrder.id,
        orderNumber: newOrder.orderNumber,
        vendorId: vendorId || null,
        storeName,
        subtotal,
        shipping,
        total,
        itemCount: orderItems.length,
      });
    }

    // Clear the cart
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return orders;
  }, { timeout: 30000 });

  const subtotal = createdOrders.reduce((s, o) => s + o.subtotal, 0);
  const shipping = createdOrders.reduce((s, o) => s + o.shipping, 0);
  const total = subtotal + shipping;

  return {
    checkoutSessionId,
    orders: createdOrders,
    summary: {
      orderCount: createdOrders.length,
      subtotal,
      shipping,
      total,
    },
  };
}
