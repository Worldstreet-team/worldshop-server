import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { CheckoutValidationResult } from '../types/order.types';

// Shipping configuration (same as cart)
const SHIPPING = {
  FREE_SHIPPING_THRESHOLD: 50000, // ₦50,000
  FLAT_RATE: 2500, // ₦2,500
} as const;

/**
 * Check if cart contains only digital products (no shipping needed).
 */
export function isDigitalOnlyCart(
  items: Array<{ product: { type?: string } }>
): boolean {
  return items.every((item) => item.product.type === 'DIGITAL');
}

/**
 * Validate cart for checkout.
 * Checks stock availability and calculates final totals.
 * Skips shipping for digital-only carts.
 */
export async function validateCart(userId: string): Promise<CheckoutValidationResult> {
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
    return {
      valid: false,
      issues: ['Your cart is empty'],
    };
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

  // Check each item
  for (const item of cart.items) {
    const availableStock = item.variant?.stock ?? item.product.stock;
    const price = item.variant?.price ?? item.product.salePrice ?? item.product.basePrice;

    // Check if product is still active
    if (!item.product.isActive) {
      issues.push(`${item.product.name} is no longer available`);
      continue;
    }

    // Check stock
    if (availableStock < item.quantity) {
      if (availableStock === 0) {
        issues.push(`${item.product.name} is out of stock`);
      } else {
        issues.push(
          `Only ${availableStock} of ${item.product.name} available (you have ${item.quantity} in cart)`
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

  // No shipping for digital-only carts
  const digitalOnly = isDigitalOnlyCart(cart.items);
  const shipping = digitalOnly ? 0 : (subtotal >= SHIPPING.FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING.FLAT_RATE);
  const total = subtotal + shipping;

  return {
    valid: issues.length === 0,
    issues,
    cart: {
      items: validatedItems,
      subtotal,
      shipping,
      total,
    },
  };
}

/**
 * Get the shipping rate based on subtotal.
 */
export function calculateShipping(subtotal: number): number {
  return subtotal >= SHIPPING.FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING.FLAT_RATE;
}
