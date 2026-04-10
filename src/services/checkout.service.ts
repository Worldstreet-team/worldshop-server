import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { createHash, randomUUID } from 'crypto';
import { OrderStatus } from '../../generated/prisma';
import type {
  CheckoutIssue,
  VendorGroup,
  CheckoutSessionPreview,
  CheckoutSessionResult,
  ConfirmCheckoutSessionInput,
  ShippingAddress,
} from '../types/order.types';
import { signR2Key } from '../utils/signUrl';

// ─── Shipping config ────────────────────────────────────────────

const SHIPPING = {
  FREE_SHIPPING_THRESHOLD: 50000, // ₦50,000
  FLAT_RATE: 2500, // ₦2,500
} as const;

export function calculateShipping(subtotal: number): number {
  return subtotal >= SHIPPING.FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING.FLAT_RATE;
}

export function isDigitalOnlyCart(
  items: Array<{ product: { type?: string } }>,
): boolean {
  return items.every((item) => item.product.type === 'DIGITAL');
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

    if (!item.product.isActive) {
      issues.push(`${item.product.name} is no longer available`);
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
      return `${item.productId}:${item.variantId || ''}:${item.quantity}:${price}:${stock}:${item.product.isActive}`;
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
          productImage: primaryImage,
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
    if (!item.product.isActive) {
      issues.push({
        productId: item.productId,
        productName: item.product.name,
        reason: 'INACTIVE',
        detail: `${item.product.name} is no longer available`,
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

  return {
    snapshotToken,
    vendorGroups,
    issues,
    requiresShipping,
    summary: {
      orderCount: vendorGroups.length,
      subtotal,
      shipping,
      total,
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

  // Re-validate stock/availability inside the transaction
  for (const item of items) {
    if (!item.product.isActive) {
      throw createError(
        400,
        `${item.product.name} is no longer available`,
      );
    }
    if (item.product.type !== 'DIGITAL') {
      const stock = item.variant?.stock ?? item.product.stock;
      if (stock < item.quantity) {
        throw createError(
          400,
          `Only ${stock} of ${item.product.name} available`,
        );
      }
    }
  }

  // Group items by vendor
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

  // Create all orders atomically in a transaction
  const createdOrders = await prisma.$transaction(async (tx) => {
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
