import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { OrderStatus } from '../../generated/prisma';
import type { OrderWithItems, PaginatedOrders } from '../types/order.types';
import type {
  VendorOrdersQueryInput,
  UpdateVendorOrderStatusInput,
  ExtendDeliveryDateInput,
} from '../validators/vendor.order.validator';
import { formatOrderResponse } from './order.service';

// ─── Vendor-allowed status transitions ──────────────────────────
// Vendors drive the full fulfilment path:
//   PAID → PROCESSING → PACKAGED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED
// A failed delivery can be re-attempted (→ OUT_FOR_DELIVERY) or escalated to
// an admin refund. Cancel/refund stay admin-only.
const VENDOR_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.CREATED]: [],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING],
  [OrderStatus.PROCESSING]: [OrderStatus.PACKAGED, OrderStatus.SHIPPED],
  [OrderStatus.PACKAGED]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERY_FAILED,
  ],
  [OrderStatus.OUT_FOR_DELIVERY]: [
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERY_FAILED,
  ],
  [OrderStatus.DELIVERY_FAILED]: [OrderStatus.OUT_FOR_DELIVERY],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

const ORDER_INCLUDE = {
  items: {
    include: {
      product: true,
      variant: true,
    },
  },
  statusHistory: {
    orderBy: { createdAt: 'desc' as const },
  },
};

/**
 * List orders belonging to a specific vendor, with pagination and filtering.
 */
export async function getVendorOrders(
  vendorId: string,
  query: VendorOrdersQueryInput,
): Promise<PaginatedOrders> {
  const { page, limit, status, search, sortBy } = query;

  const where: Record<string, unknown> = { vendorId };

  if (status) where.status = status;

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

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
      include: ORDER_INCLUDE,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.order.count({ where: where as any }),
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
 * Get a single order by ID, scoped to the vendor.
 */
export async function getVendorOrder(
  orderId: string,
  vendorId: string,
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: ORDER_INCLUDE,
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  if (order.vendorId !== vendorId) {
    throw createError(403, 'Not authorized to view this order');
  }

  return formatOrderResponse(order);
}

/**
 * Update order status with restricted vendor transitions.
 * Vendors can only: PAID → PROCESSING → DELIVERED
 */
export async function updateVendorOrderStatus(
  orderId: string,
  vendorId: string,
  input: UpdateVendorOrderStatusInput,
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  if (order.vendorId !== vendorId) {
    throw createError(403, 'Not authorized to update this order');
  }

  const newStatus = input.status as OrderStatus;
  const currentStatus = order.status;

  const allowed = VENDOR_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    throw createError(
      400,
      `Cannot transition from "${currentStatus}" to "${newStatus}". Allowed: ${
        allowed.length > 0 ? allowed.join(', ') : 'none'
      }`,
    );
  }

  const defaultNotes: Partial<Record<OrderStatus, string>> = {
    [OrderStatus.PACKAGED]: 'Order packaged and ready for pickup',
    [OrderStatus.SHIPPED]: input.trackingNumber
      ? `Shipped — tracking number ${input.trackingNumber}`
      : 'Shipped',
    [OrderStatus.OUT_FOR_DELIVERY]:
      currentStatus === OrderStatus.DELIVERY_FAILED
        ? 'Delivery re-attempt scheduled'
        : 'Out for delivery',
    [OrderStatus.DELIVERY_FAILED]: 'Delivery attempt failed',
  };

  const updateData: Record<string, unknown> = {
    status: newStatus,
    statusHistory: {
      create: {
        status: newStatus,
        note:
          input.note ||
          defaultNotes[newStatus] ||
          `Status changed to ${newStatus} by vendor`,
      },
    },
  };

  if (newStatus === OrderStatus.SHIPPED) {
    updateData.shippedAt = new Date();
    updateData.trackingNumber = input.trackingNumber;
  } else if (newStatus === OrderStatus.DELIVERED) {
    updateData.deliveredAt = new Date();
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: updateData as any,
    include: ORDER_INCLUDE,
  });

  return formatOrderResponse(updatedOrder);
}

/**
 * Extend the expected delivery date on a delayed order. Only valid while the
 * order is in transit (SHIPPED / OUT_FOR_DELIVERY / DELIVERY_FAILED); the
 * change is recorded in the status history so the buyer sees it.
 */
export async function extendVendorDeliveryDate(
  orderId: string,
  vendorId: string,
  input: ExtendDeliveryDateInput,
): Promise<OrderWithItems> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) {
    throw createError(404, 'Order not found');
  }
  if (order.vendorId !== vendorId) {
    throw createError(403, 'Not authorized to update this order');
  }

  const extendable: OrderStatus[] = [
    OrderStatus.PROCESSING,
    OrderStatus.PACKAGED,
    OrderStatus.SHIPPED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERY_FAILED,
  ];
  if (!extendable.includes(order.status)) {
    throw createError(
      400,
      `Cannot change the expected delivery date of a ${order.status} order`,
    );
  }

  const formatted = input.expectedDeliveryDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      expectedDeliveryDate: input.expectedDeliveryDate,
      statusHistory: {
        create: {
          status: order.status,
          note: input.note
            ? `Expected delivery moved to ${formatted} — ${input.note}`
            : `Expected delivery moved to ${formatted}`,
        },
      },
    },
    include: ORDER_INCLUDE,
  });

  return formatOrderResponse(updatedOrder);
}
