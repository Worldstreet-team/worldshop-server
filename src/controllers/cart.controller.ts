import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as cartService from '../services/cart.service';
import {
  addToCartSchema,
  updateCartItemSchema,
  mergeCartSchema,
} from '../validators/cart.validator';

/**
 * Extract user ID or session ID from request.
 * Authenticated users use userId, guests use sessionId from header.
 */
function getCartIdentifiers(req: Request): { userId?: string; sessionId?: string } {
  const userId = req.user?.id;
  const rawSessionId = req.headers['x-session-id'];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  return { userId, sessionId };
}

/**
 * GET /api/v1/cart
 * Get the current cart (by userId or sessionId).
 */
export const getCart = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { userId, sessionId } = getCartIdentifiers(req);
    const cart = await cartService.getOrCreateCart(userId, sessionId);

    res.status(200).json({
      success: true,
      data: cart,
    });
  }
);

/**
 * POST /api/v1/cart/items
 * Add item to cart.
 */
export const addToCart = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { userId, sessionId } = getCartIdentifiers(req);
    const input = addToCartSchema.parse(req.body);
    const cart = await cartService.addToCart(input, userId, sessionId);

    res.status(200).json({
      success: true,
      data: cart,
    });
  }
);

/**
 * PATCH /api/v1/cart/items/:id
 * Update cart item quantity.
 */
export const updateCartItem = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { userId, sessionId } = getCartIdentifiers(req);
    const itemId = req.params.id as string;
    const input = updateCartItemSchema.parse(req.body);
    const cart = await cartService.updateCartItem(itemId, input, userId, sessionId);

    res.status(200).json({
      success: true,
      data: cart,
    });
  }
);

/**
 * DELETE /api/v1/cart/items/:id
 * Remove item from cart.
 */
export const removeCartItem = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { userId, sessionId } = getCartIdentifiers(req);
    const itemId = req.params.id as string;
    const cart = await cartService.removeCartItem(itemId, userId, sessionId);

    res.status(200).json({
      success: true,
      data: cart,
    });
  }
);

/**
 * DELETE /api/v1/cart
 * Clear entire cart.
 */
export const clearCart = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const { userId, sessionId } = getCartIdentifiers(req);
    const result = await cartService.clearCart(userId, sessionId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * POST /api/v1/cart/merge
 * Merge guest cart into authenticated user's cart.
 * Requires authentication.
 */
export const mergeCart = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to merge cart',
      });
    }

    const input = mergeCartSchema.parse(req.body);
    const cart = await cartService.mergeCart(userId, input.sessionId);

    res.status(200).json({
      success: true,
      data: cart,
    });
  }
);
