import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { ShippingMethod, DeliveryPartner } from '../../generated/prisma';
import { calculateShipping } from '../types/cart.types';

/**
 * Delivery estimates & shipping methods (Test 6). Method price is per vendor
 * shipment; a method with `freeAbove` waives the fee once the shipment
 * subtotal reaches that amount. When no methods are configured, checkout
 * falls back to the legacy flat-rate rule so nothing breaks mid-rollout.
 */

export type ShippingMethodWithPartner = ShippingMethod & {
  partner: DeliveryPartner;
};

export async function listActiveShippingMethods(): Promise<ShippingMethodWithPartner[]> {
  return prisma.shippingMethod.findMany({
    where: { isActive: true, partner: { isActive: true } },
    include: { partner: true },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Resolve the shipping method for a checkout: the requested one (must be
 * active), or the first active method as the default. Returns null when no
 * methods exist — callers use the legacy flat rate then.
 */
export async function resolveShippingMethod(
  shippingMethodId?: string | null,
): Promise<ShippingMethodWithPartner | null> {
  if (shippingMethodId) {
    const method = await prisma.shippingMethod.findUnique({
      where: { id: shippingMethodId },
      include: { partner: true },
    });
    if (!method || !method.isActive || !method.partner.isActive) {
      throw createError(400, 'Selected delivery method is not available');
    }
    return method;
  }

  const methods = await listActiveShippingMethods();
  return methods[0] ?? null;
}

/** Shipping cost for one vendor shipment. */
export function computeGroupShipping(
  method: ShippingMethodWithPartner | null,
  subtotal: number,
): number {
  if (!method) return calculateShipping(subtotal); // legacy fallback
  if (method.freeAbove != null && subtotal >= method.freeAbove) return 0;
  return method.price;
}

/** Latest expected arrival for a method, from now. */
export function computeExpectedDeliveryDate(method: ShippingMethodWithPartner): Date {
  const date = new Date();
  date.setDate(date.getDate() + method.maxDays);
  return date;
}

/** Serializable summary for API responses. */
export function shippingMethodSummary(method: ShippingMethodWithPartner) {
  return {
    id: method.id,
    name: method.name,
    partnerName: method.partner.name,
    price: method.price,
    freeAbove: method.freeAbove,
    minDays: method.minDays,
    maxDays: method.maxDays,
    expectedDeliveryDate: computeExpectedDeliveryDate(method).toISOString(),
  };
}
