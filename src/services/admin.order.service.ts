import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { OrderStatus } from '../../generated/prisma';
import type {
  AdminOrdersQueryInput,
  UpdateOrderStatusInput,
  OrderStatsQueryInput,
} from '../validators/admin.order.validator';
import type { OrderWithItems, PaginatedOrders } from '../types/order.types';
import { signR2Key } from '../utils/signUrl';

// ─── Valid status transitions ───────────────────────────────────
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.CREATED]: [OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

/**
 * List all orders for admin (no ownership filter).
 */
export async function adminListOrders(
  query: AdminOrdersQueryInput
): Promise<PaginatedOrders> {
  const { page, limit, status, search, dateFrom, dateTo, sortBy } = query;

  const where: Record<string, unknown> = {};

  // Status filter
  if (status) where.status = status;

  // Search by order number or user email
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { userId: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    where.createdAt = createdAt;
  }

  // Sorting
  type OrderBy = Record<string, 'asc' | 'desc'>;
  let orderBy: OrderBy;
  switch (sortBy) {
    case 'oldest':
      orderBy = { createdAt: 'asc' };
      break;
    case 'total_asc':
      orderBy = { total: 'asc' };
      break;
    case 'total_desc':
      orderBy = { total: 'desc' };
      break;
    case 'newest':
    default:
      orderBy = { createdAt: 'desc' };
  }

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: where as any,
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
        payment: true,
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.order.count({ where: where as any }),
  ]);

  return {
    data: await Promise.all(orders.map(formatAdminOrderResponse)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get a single order by ID (admin — no ownership check).
 */
export async function adminGetOrder(orderId: string): Promise<OrderWithItems> {
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
      payment: true,
    },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  return formatAdminOrderResponse(order);
}

/**
 * Update order status with validation of allowed transitions.
 */
export async function updateOrderStatus(
  orderId: string,
  input: UpdateOrderStatusInput,
  adminId: string
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  const newStatus = input.status as OrderStatus;
  const currentStatus = order.status;

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    throw createError(
      400,
      `Cannot transition from "${currentStatus}" to "${newStatus}". Allowed: ${
        allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'
      }`
    );
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    status: newStatus,
    statusHistory: {
      create: {
        status: newStatus,
        note: input.note || `Status changed to ${newStatus} by admin`,
      },
    },
  };

  // Set timestamp fields for specific transitions
  if (newStatus === OrderStatus.SHIPPED) {
    updateData.shippedAt = new Date();
    if (input.trackingNumber) {
      updateData.notes = order.notes
        ? `${order.notes}\nTracking: ${input.trackingNumber}`
        : `Tracking: ${input.trackingNumber}`;
    }
  } else if (newStatus === OrderStatus.DELIVERED) {
    updateData.deliveredAt = new Date();
  }

  // Handle cancellation — restore stock for physical products
  if (newStatus === OrderStatus.CANCELLED || newStatus === OrderStatus.REFUNDED) {
    const updatedOrder = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: updateData as any,
        include: {
          items: { include: { product: true, variant: true } },
          statusHistory: { orderBy: { createdAt: 'desc' } },
          payment: true,
        },
      });

      // Restore stock (only for non-CREATED orders where stock was decremented)
      if (currentStatus !== OrderStatus.CREATED) {
        for (const item of order.items) {
          // Check if the product is digital (don't restore stock for digital)
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { type: true },
          });
          if (product?.type === 'DIGITAL') continue;

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
      }

      return updated;
    });

    return formatAdminOrderResponse(updatedOrder);
  }

  // Normal status update (no stock changes)
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updateData as any,
    include: {
      items: { include: { product: true, variant: true } },
      statusHistory: { orderBy: { createdAt: 'desc' } },
      payment: true,
    },
  });

  return formatAdminOrderResponse(updatedOrder);
}

/**
 * Get order statistics for admin dashboard.
 */
export async function getOrderStats(query: OrderStatsQueryInput) {
  const { period } = query;

  // Calculate date range
  let dateFilter: Date | undefined;
  const now = new Date();
  switch (period) {
    case '7d':
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '12m':
      dateFilter = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
    default:
      dateFilter = undefined;
  }

  const where: Record<string, unknown> = {};
  if (dateFilter) {
    where.createdAt = { gte: dateFilter };
  }

  // Get order counts by status
  const [
    totalOrders,
    paidOrders,
    processingOrders,
    shippedOrders,
    deliveredOrders,
    cancelledOrders,
    refundedOrders,
  ] = await Promise.all([
    prisma.order.count({ where: where as any }),
    prisma.order.count({ where: { ...where, status: OrderStatus.PAID } as any }),
    prisma.order.count({ where: { ...where, status: OrderStatus.PROCESSING } as any }),
    prisma.order.count({ where: { ...where, status: OrderStatus.SHIPPED } as any }),
    prisma.order.count({ where: { ...where, status: OrderStatus.DELIVERED } as any }),
    prisma.order.count({ where: { ...where, status: OrderStatus.CANCELLED } as any }),
    prisma.order.count({ where: { ...where, status: OrderStatus.REFUNDED } as any }),
  ]);

  // Calculate revenue (from completed/paid orders)
  const revenueResult = await prisma.order.aggregate({
    where: {
      ...where,
      status: { in: [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
    } as any,
    _sum: { total: true },
  });

  const totalRevenue = revenueResult._sum.total || 0;

  return {
    totalOrders,
    statusBreakdown: {
      paid: paidOrders,
      processing: processingOrders,
      shipped: shippedOrders,
      delivered: deliveredOrders,
      cancelled: cancelledOrders,
      refunded: refundedOrders,
    },
    totalRevenue,
    period,
  };
}

// ─── Format order response (admin — includes payment info) ──────
async function formatAdminOrderResponse(order: {
  id: string;
  orderNumber: string;
  userId: string;
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
    product?: { id: string; name: string; slug: string; images: unknown };
    variant?: { id: string; name: string } | null;
  }>;
  statusHistory: Array<{
    id: string;
    orderId: string;
    status: OrderStatus;
    note: string | null;
    createdAt: Date;
  }>;
  payment?: {
    id: string;
    status: string;
    provider: string;
    reference: string | null;
    channel: string | null;
    paidAt: Date | null;
  } | null;
}): Promise<OrderWithItems> {
  // Sign product images in order items
  const signedItems = await Promise.all(
    order.items.map(async (item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      productImage: item.productImage ? await signR2Key(item.productImage) : null,
      sku: item.sku,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      createdAt: item.createdAt,
      product: item.product,
      variant: item.variant,
    }))
  );

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    status: order.status,
    shippingAddress: order.shippingAddress as any,
    billingAddress: order.billingAddress as any,
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
    payment: order.payment
      ? {
          id: order.payment.id,
          status: order.payment.status,
          provider: order.payment.provider,
          reference: order.payment.reference || '',
          channel: order.payment.channel,
          paidAt: order.payment.paidAt,
        }
      : undefined,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
  } as OrderWithItems & { payment?: unknown };
}
