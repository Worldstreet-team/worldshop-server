import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type {
  OrderWithItems,
  PaginatedOrders,
  ShippingAddress,
} from '../types/order.types';
import type {
  CreateOrderInput,
  OrdersQueryInput,
  CancelOrderInput,
} from '../validators/order.validator';
import { calculateShipping, isDigitalOnlyCart } from './checkout.service';
import { OrderStatus } from '../../generated/prisma';
import { signR2Key, signProductImages } from '../utils/signUrl';

/**
 * Generate a unique order number.
 * Format: WS-YYYYMMDD-XXXXX (e.g., WS-20260209-A3F5B)
 */
function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `WS-${dateStr}-${random}`;
}

/**
 * Create an order from the user's cart.
 * This consumes the cart, creates the order, and decrements stock.
 */
export async function createOrder(
  userId: string,
  input: CreateOrderInput,
): Promise<OrderWithItems> {
  // Get user's cart
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw createError(400, 'Your cart is empty');
  }

  // Check if this is a digital-only order
  const digitalOnly = isDigitalOnlyCart(cart.items);

  // Validate stock and calculate totals
  let subtotal = 0;
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

  for (const item of cart.items) {
    const isDigital = item.product.type === 'DIGITAL';
    const availableStock = item.variant?.stock ?? item.product.stock;
    const price =
      item.variant?.price ?? item.product.salePrice ?? item.product.basePrice;

    // Check product is active
    if (!item.product.isActive) {
      throw createError(400, `${item.product.name} is no longer available`);
    }

    // Check stock (skip for digital products — unlimited)
    if (!isDigital && availableStock < item.quantity) {
      throw createError(
        400,
        `Only ${availableStock} of ${item.product.name} available`,
      );
    }

    // Get primary image
    let primaryImage: string | null = null;
    try {
      const images = Array.isArray(item.product.images)
        ? item.product.images
        : JSON.parse(item.product.images as string);
      const primary = images.find(
        (img: { isPrimary?: boolean }) => img.isPrimary,
      );
      // Prefer cloudflareId (R2 key) so the snapshot can be signed on retrieval.
      // Fall back to url only if no cloudflareId exists.
      const bestImg = primary || images[0];
      primaryImage = (bestImg?.cloudflareId as string) || bestImg?.url || null;
    } catch {
      // No images
    }

    const itemTotal = price * item.quantity;
    subtotal += itemTotal;

    orderItems.push({
      productId: item.productId,
      variantId: item.variantId,
      productName: item.product.name,
      productImage: primaryImage,
      sku:
        item.variant?.stockKeepingUnit ?? item.product.stockKeepingUnit ?? null,
      variantName: item.variant?.name ?? null,
      quantity: item.quantity,
      unitPrice: price,
      totalPrice: itemTotal,
    });
  }

  const shipping = digitalOnly ? 0 : calculateShipping(subtotal);
  const total = subtotal + shipping;

  // For digital-only orders, shipping address can be empty
  const shippingAddress = digitalOnly
    ? ((input.shippingAddress || {}) as object)
    : (input.shippingAddress as object);

  // Create order in a transaction
  const order = await prisma.$transaction(async (tx) => {
    // Create the order
    const newOrder = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId,
        status: OrderStatus.CREATED,
        shippingAddress,
        billingAddress: input.billingAddress as object | undefined,
        notes: input.notes,
        subtotal,
        shipping,
        discount: 0,
        total,
        items: {
          create: orderItems,
        },
        statusHistory: {
          create: {
            status: OrderStatus.CREATED,
            note: 'Order placed',
          },
        },
      },
      include: {
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // Decrement product stock (skip for digital products)
    for (const item of cart.items) {
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

    // Clear the cart
    await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return newOrder;
  });

  return formatOrderResponse(order);
}

/**
 * Get user's orders with pagination.
 */
export async function getOrders(
  userId: string,
  query: OrdersQueryInput,
): Promise<PaginatedOrders> {
  const { page, limit, status } = query;
  const skip = (page - 1) * limit;

  const where: { userId: string; status?: OrderStatus } = { userId };
  if (status) {
    where.status = status as OrderStatus;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    data: await Promise.all(orders.map(formatOrderResponse)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get a single order by ID.
 */
export async function getOrderById(
  orderId: string,
  userId: string,
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  // Verify ownership
  if (order.userId !== userId) {
    throw createError(403, 'Not authorized to view this order');
  }

  return formatOrderResponse(order);
}

/**
 * Get a single order by order number.
 */
export async function getOrderByNumber(
  orderNumber: string,
  userId: string,
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  // Verify ownership
  if (order.userId !== userId) {
    throw createError(403, 'Not authorized to view this order');
  }

  return formatOrderResponse(order);
}

/**
 * Cancel an order.
 * Only allowed if status is CREATED (before payment).
 */
export async function cancelOrder(
  orderId: string,
  userId: string,
  input?: CancelOrderInput,
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
    },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  // Verify ownership
  if (order.userId !== userId) {
    throw createError(403, 'Not authorized to cancel this order');
  }

  // Check if cancellation is allowed
  const cancellableStatuses: OrderStatus[] = [OrderStatus.CREATED];
  if (!cancellableStatuses.includes(order.status)) {
    throw createError(
      400,
      `Cannot cancel order with status "${order.status}". Only unpaid orders can be cancelled.`,
    );
  }

  // Cancel order and restore stock
  const updatedOrder = await prisma.$transaction(async (tx) => {
    // Update order status
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        statusHistory: {
          create: {
            status: OrderStatus.CANCELLED,
            note: input?.reason || 'Cancelled by customer',
          },
        },
      },
      include: {
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // Restore stock
    for (const item of order.items) {
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

    return updated;
  });

  return formatOrderResponse(updatedOrder);
}

/**
 * Format order for API response.
 * Signs R2 image keys in order items.
 */
export async function formatOrderResponse(order: {
  id: string;
  orderNumber: string;
  userId: string;
  vendorId: string | null;
  checkoutSessionId: string | null;
  status: OrderStatus;
  shippingAddress: unknown;
  billingAddress: unknown;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  couponCode: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  items: Array<{
    id: string;
    orderId: string;
    productId: string;
    variantId: string | null;
    productName: string;
    productImage: string | null;
    sku: string | null;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    createdAt: Date;
    product?: {
      id: string;
      name: string;
      slug: string;
      images: unknown;
    };
    variant?: {
      id: string;
      name: string;
    } | null;
  }>;
  statusHistory: Array<{
    id: string;
    orderId: string;
    status: OrderStatus;
    note: string | null;
    createdAt: Date;
  }>;
}): Promise<OrderWithItems> {
  // Sign product images in order items
  const signedItems = await Promise.all(
    order.items.map(async (item) => {
      // Sign the item snapshot image (stored as R2 key for new orders)
      const signedProductImage = item.productImage
        ? await signR2Key(item.productImage)
        : null;

      // Sign the nested live product's images array (cloudflareId → url)
      let signedProduct = item.product;
      if (signedProduct?.images) {
        const signedImages = await signProductImages(signedProduct.images);
        signedProduct = { ...signedProduct, images: signedImages };
      }

      return {
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productName,
        productImage: signedProductImage,
        sku: item.sku,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        createdAt: item.createdAt,
        product: signedProduct,
        variant: item.variant,
      };
    }),
  );

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    vendorId: order.vendorId,
    checkoutSessionId: order.checkoutSessionId,
    status: order.status,
    shippingAddress: order.shippingAddress as ShippingAddress,
    billingAddress: order.billingAddress as ShippingAddress | null,
    subtotal: order.subtotal,
    shipping: order.shipping,
    discount: order.discount,
    total: order.total,
    couponCode: order.couponCode,
    notes: order.notes,
    items: signedItems,
    statusHistory: order.statusHistory.map((h) => ({
      id: h.id,
      orderId: h.orderId,
      status: h.status,
      note: h.note,
      createdAt: h.createdAt,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
  };
}
