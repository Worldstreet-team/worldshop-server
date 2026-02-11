import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { CartWithTotals, CartItemWithProduct, SHIPPING_CONFIG } from '../types/cart.types';
import type { AddToCartInput, UpdateCartItemInput } from '../validators/cart.validator';
import { signProductImages, signR2Key } from '../utils/signUrl';

// Shipping configuration (hardcoded)
const SHIPPING = {
  FREE_SHIPPING_THRESHOLD: 50000, // ₦50,000
  FLAT_RATE: 2500, // ₦2,500
} as const;

/**
 * Get or create a cart by userId (authenticated) or sessionId (guest).
 */
export async function getOrCreateCart(
  userId?: string,
  sessionId?: string
): Promise<CartWithTotals> {
  if (!userId && !sessionId) {
    throw createError(400, 'Either userId or sessionId is required');
  }

  // Upsert can still collide under heavy concurrency in MongoDB.
  // If it does, fall back to fetching the existing cart.
  const include = {
    items: {
      include: {
        product: true,
        variant: true,
      },
      orderBy: { createdAt: 'desc' as const },
    },
  };

  let cart;

  // =====================
  // AUTHENTICATED USER
  // =====================

  if (userId) {
    // 1. Try user cart
    cart = await prisma.cart.findUnique({
      where: { userId },
      include,
    });


    // 2. If none, migrate guest cart (if exists)
    if (!cart && sessionId) {
      const guestCart = await prisma.cart.findUnique({
        where: { sessionId },
      });

      if (guestCart) {
        // Migrate guest cart to user: use unique placeholder since MongoDB treats null as unique
        cart = await prisma.cart.update({
          where: { id: guestCart.id },
          data: {
            userId,
            sessionId: `migrated_${userId}_${Date.now()}`,
            updatedAt: new Date(),
          },
          include,
        });
      }
    }

    // 3. Still nothing? Create fresh user cart
    if (!cart) {
      cart = await prisma.cart.create({
        data: { 
          userId, 
          sessionId: `user_${userId}` 
        },
        include,
      });
    }
  }

  // =====================
  // GUEST USER
  // =====================
  else {
    cart = await prisma.cart.findUnique({
      where: { sessionId: sessionId as string },
      include,
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { sessionId },
        include,
      });
    }
  }
  return formatCartResponse(cart);
}

/**
 * Add item to cart (or update quantity if already exists).
 */
export async function addToCart(
  input: AddToCartInput,
  userId?: string,
  sessionId?: string
): Promise<CartWithTotals> {
  if (!userId && !sessionId) {
    throw createError(400, 'Either userId or sessionId is required');
  }

  const { productId, variantId, quantity } = input;

  // Validate product exists and is active
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    include: { variants: true },
  });

  if (!product) {
    throw createError(404, 'Product not found');
  }

  // If variantId specified, validate it belongs to the product
  let variant = null;
  if (variantId) {
    variant = product.variants.find((v) => v.id === variantId && v.isActive);
    if (!variant) {
      throw createError(404, 'Product variant not found');
    }
  }

  // Check stock
  const availableStock = variant?.stock ?? product.stock;
  if (availableStock < quantity) {
    throw createError(400, `Only ${availableStock} items available in stock`);
  }

  // Get or create cart (find first, then create if not exists)
  let cart;

  if (userId) {
    // Authenticated user: find by userId
    cart = await prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      // Use unique sessionId to avoid MongoDB null conflicts
      cart = await prisma.cart.create({ 
        data: { 
          userId, 
          sessionId: `user_${userId}` 
        } 
      });
    }
  } else {
    // Guest: find by sessionId
    cart = await prisma.cart.findUnique({ where: { sessionId: sessionId as string } });
    if (!cart) {
      cart = await prisma.cart.create({ data: { sessionId } });
    }
  }

  // Check if item already exists in cart
  const existingItem = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      productId,
      variantId: variantId || null,
    },
  });

  if (existingItem) {
    // Update quantity
    const newQuantity = existingItem.quantity + quantity;
    if (newQuantity > availableStock) {
      throw createError(400, `Only ${availableStock} items available in stock`);
    }

    await prisma.cartItem.update({
      where: { id: existingItem.id },
      data: { quantity: newQuantity },
    });
  } else {
    // Add new item
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        variantId: variantId || null,
        quantity,
      },
    });
  }

  // Return updated cart
  return getOrCreateCart(userId, sessionId);
}

/**
 * Update cart item quantity.
 */
export async function updateCartItem(
  itemId: string,
  input: UpdateCartItemInput,
  userId?: string,
  sessionId?: string
): Promise<CartWithTotals> {
  if (!userId && !sessionId) {
    throw createError(400, 'Either userId or sessionId is required');
  }

  const { quantity } = input;

  // Find the cart item and verify ownership
  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: {
      cart: true,
      product: true,
      variant: true,
    },
  });

  if (!cartItem) {
    throw createError(404, 'Cart item not found');
  }

  // Verify cart ownership
  const isOwner = userId
    ? cartItem.cart.userId === userId
    : cartItem.cart.sessionId === sessionId;

  if (!isOwner) {
    throw createError(403, 'Not authorized to update this cart item');
  }

  // Check stock
  const availableStock = cartItem.variant?.stock ?? cartItem.product.stock;
  if (quantity > availableStock) {
    throw createError(400, `Only ${availableStock} items available in stock`);
  }

  // Update quantity
  await prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
  });

  return getOrCreateCart(userId, sessionId);
}

/**
 * Remove item from cart.
 */
export async function removeCartItem(
  itemId: string,
  userId?: string,
  sessionId?: string
): Promise<CartWithTotals> {
  if (!userId && !sessionId) {
    throw createError(400, 'Either userId or sessionId is required');
  }

  // Find the cart item and verify ownership
  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true },
  });

  if (!cartItem) {
    throw createError(404, 'Cart item not found');
  }

  // Verify cart ownership
  const isOwner = userId
    ? cartItem.cart.userId === userId
    : cartItem.cart.sessionId === sessionId;

  if (!isOwner) {
    throw createError(403, 'Not authorized to remove this cart item');
  }

  // Delete item
  await prisma.cartItem.delete({
    where: { id: itemId },
  });

  return getOrCreateCart(userId, sessionId);
}

/**
 * Clear all items from cart.
 */
export async function clearCart(
  userId?: string,
  sessionId?: string
): Promise<{ message: string }> {
  if (!userId && !sessionId) {
    throw createError(400, 'Either userId or sessionId is required');
  }

  // Find cart
  const cart = await prisma.cart.findFirst({
    where: userId ? { userId } : { sessionId },
  });

  if (!cart) {
    return { message: 'Cart already empty' };
  }

  // Delete all items
  await prisma.cartItem.deleteMany({
    where: { cartId: cart.id },
  });

  return { message: 'Cart cleared successfully' };
}

/**
 * Merge guest cart into user cart after login.
 * Items from guest cart are added to user cart.
 * If same product exists, quantities are combined (up to stock limit).
 */
export async function mergeCart(
  userId: string,
  guestSessionId: string
): Promise<CartWithTotals> {
  // Find guest cart
  const guestCart = await prisma.cart.findUnique({
    where: { sessionId: guestSessionId },
    include: {
      items: {
        include: {
          product: true,
          variant: true,
        },
      },
    },
  });

  if (!guestCart || guestCart.items.length === 0) {
    // No guest cart to merge, just return user cart
    return getOrCreateCart(userId);
  }

  // Get or create user cart
  let userCart = await prisma.cart.findUnique({
    where: { userId },
  });

  if (!userCart) {
    userCart = await prisma.cart.create({
      data: { 
        userId, 
        sessionId: `user_${userId}` 
      },
    });
  }

  // Get user's existing cart items
  const userItems = await prisma.cartItem.findMany({
    where: { cartId: userCart.id },
  });

  // Merge items from guest cart
  for (const guestItem of guestCart.items) {
    const existingItem = userItems.find(
      (item) =>
        item.productId === guestItem.productId &&
        item.variantId === guestItem.variantId
    );

    const availableStock = guestItem.variant?.stock ?? guestItem.product.stock;

    if (existingItem) {
      // Merge quantities (capped at available stock)
      const newQuantity = Math.min(
        existingItem.quantity + guestItem.quantity,
        availableStock
      );

      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQuantity },
      });
    } else {
      // Add new item (capped at available stock)
      const quantity = Math.min(guestItem.quantity, availableStock);

      if (quantity > 0) {
        await prisma.cartItem.create({
          data: {
            cartId: userCart.id,
            productId: guestItem.productId,
            variantId: guestItem.variantId,
            quantity,
          },
        });
      }
    }
  }

  // Delete guest cart and its items
  await prisma.cart.delete({
    where: { id: guestCart.id },
  });

  return getOrCreateCart(userId);
}

/**
 * Format cart with computed totals for API response.
 */
async function formatCartResponse(cart: {
  id: string;
  userId: string | null;
  sessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    cartId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
    createdAt: Date;
    updatedAt: Date;
    product: {
      id: string;
      name: string;
      slug: string;
      basePrice: number;
      salePrice: number | null;
      stock: number;
      images: unknown;
    };
    variant: {
      id: string;
      name: string;
      price: number | null;
      stock: number;
    } | null;
  }>;
}): Promise<CartWithTotals> {
  const items: CartItemWithProduct[] = await Promise.all(cart.items.map(async (item) => {
    // Determine the price (variant price > sale price > base price)
    const price =
      item.variant?.price ?? item.product.salePrice ?? item.product.basePrice;

    // Parse images
    let images: Array<{ url: string; alt?: string; isPrimary?: boolean }> = [];
    try {
      images = Array.isArray(item.product.images)
        ? item.product.images as Array<{ url: string; alt?: string; isPrimary?: boolean }>
        : JSON.parse(item.product.images as string);
    } catch {
      images = [];
    }

    // Sign image URLs
    const signedImages = await signProductImages(images);

    return {
      id: item.id,
      cartId: item.cartId,
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      price,
      totalPrice: price * item.quantity,
      product: {
        id: item.product.id,
        name: item.product.name,
        slug: item.product.slug,
        basePrice: item.product.basePrice,
        salePrice: item.product.salePrice,
        stock: item.product.stock,
        images: signedImages as Array<{ url: string; alt?: string; isPrimary?: boolean }>,
      },
      variant: item.variant
        ? {
          id: item.variant.id,
          name: item.variant.name,
          price: item.variant.price,
          stock: item.variant.stock,
        }
        : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }));

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

  // Shipping: free over threshold, else flat rate
  const shipping =
    subtotal >= SHIPPING.FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING.FLAT_RATE;

  // No discount logic in this phase
  const discount = 0;

  const total = subtotal + shipping - discount;

  return {
    id: cart.id,
    userId: cart.userId,
    sessionId: cart.sessionId,
    items,
    itemCount,
    subtotal,
    shipping,
    discount,
    total,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}
