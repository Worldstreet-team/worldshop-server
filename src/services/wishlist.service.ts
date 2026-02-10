import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import type { WishlistResponse } from '../types/wishlist.types';

/** Product fields to include in wishlist items */
const productSelect = {
  id: true,
  name: true,
  slug: true,
  basePrice: true,
  salePrice: true,
  images: true,
  stock: true,
};

/**
 * Get or create a wishlist for the user.
 */
async function getOrCreateWishlist(userId: string) {
  let wishlist = await prisma.wishlist.findUnique({
    where: { userId },
    include: {
      items: {
        include: { product: { select: productSelect } },
        orderBy: { addedAt: 'desc' },
      },
    },
  });

  if (!wishlist) {
    wishlist = await prisma.wishlist.create({
      data: { userId },
      include: {
        items: {
          include: { product: { select: productSelect } },
          orderBy: { addedAt: 'desc' },
        },
      },
    });
  }

  return wishlist as unknown as WishlistResponse;
}

/**
 * Get user's wishlist.
 */
export async function getWishlist(userId: string): Promise<WishlistResponse> {
  return getOrCreateWishlist(userId);
}

/**
 * Add a product to the wishlist.
 */
export async function addToWishlist(userId: string, productId: string): Promise<WishlistResponse> {
  // Verify product exists
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw createError(404, 'Product not found');

  const wishlist = await getOrCreateWishlist(userId);

  // Check if already in wishlist
  const existing = await prisma.wishlistItem.findUnique({
    where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
  });
  if (existing) throw createError(409, 'Product is already in your wishlist');

  await prisma.wishlistItem.create({
    data: { wishlistId: wishlist.id, productId },
  });

  // Return updated wishlist
  return getOrCreateWishlist(userId);
}

/**
 * Remove a product from the wishlist.
 */
export async function removeFromWishlist(userId: string, productId: string): Promise<WishlistResponse> {
  const wishlist = await prisma.wishlist.findUnique({ where: { userId }, select: { id: true } });
  if (!wishlist) throw createError(404, 'Wishlist not found');

  const item = await prisma.wishlistItem.findUnique({
    where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
  });
  if (!item) throw createError(404, 'Product is not in your wishlist');

  await prisma.wishlistItem.delete({ where: { id: item.id } });

  // Return updated wishlist
  return getOrCreateWishlist(userId);
}

/**
 * Check if a product is in the user's wishlist.
 */
export async function isInWishlist(userId: string, productId: string): Promise<boolean> {
  const wishlist = await prisma.wishlist.findUnique({ where: { userId }, select: { id: true } });
  if (!wishlist) return false;

  const item = await prisma.wishlistItem.findUnique({
    where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
    select: { id: true },
  });

  return !!item;
}
