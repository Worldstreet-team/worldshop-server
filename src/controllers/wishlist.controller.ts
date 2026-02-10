import { Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import * as wishlistService from '../services/wishlist.service';

/**
 * GET /api/v1/wishlist
 * Get the current user's wishlist (auth required).
 */
export const getWishlist = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const wishlist = await wishlistService.getWishlist(userId);

  res.status(200).json({ success: true, wishlist });
});

/**
 * POST /api/v1/wishlist/items
 * Add a product to the wishlist (auth required).
 */
export const addToWishlist = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { productId } = req.body;

  if (!productId) {
    res.status(400).json({ success: false, message: 'productId is required' });
    return;
  }

  const wishlist = await wishlistService.addToWishlist(userId, productId);

  res.status(201).json({ success: true, wishlist });
});

/**
 * DELETE /api/v1/wishlist/items/:productId
 * Remove a product from the wishlist (auth required).
 */
export const removeFromWishlist = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const productId = req.params.productId as string;

  const wishlist = await wishlistService.removeFromWishlist(userId, productId);

  res.status(200).json({ success: true, wishlist });
});

/**
 * GET /api/v1/wishlist/check/:productId
 * Check if a product is in the user's wishlist (auth required).
 */
export const checkWishlist = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const productId = req.params.productId as string;

  const inWishlist = await wishlistService.isInWishlist(userId, productId);

  res.status(200).json({ success: true, inWishlist });
});
