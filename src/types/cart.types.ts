/**
 * Cart types for the backend.
 * Align with Prisma schema and frontend API contracts.
 */

// ─── Cart with items and computed totals ────────────────────────
export interface CartWithTotals {
  id: string;
  userId?: string | null;
  sessionId?: string | null;
  items: CartItemWithProduct[];
  itemCount: number;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Cart item with product details ─────────────────────────────
export interface CartItemWithProduct {
  id: string;
  cartId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  price: number;
  totalPrice: number;
  product: {
    id: string;
    name: string;
    slug: string;
    basePrice: number;
    salePrice?: number | null;
    stock: number;
    images: ProductImage[];
  };
  variant?: {
    id: string;
    name: string;
    price?: number | null;
    stock: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Product image for cart display ─────────────────────────────
interface ProductImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
}

// ─── Add to cart request ────────────────────────────────────────
export interface AddToCartInput {
  productId: string;
  variantId?: string;
  quantity: number;
}

// ─── Update cart item request ───────────────────────────────────
export interface UpdateCartItemInput {
  quantity: number;
}

// ─── Cart merge request ─────────────────────────────────────────
export interface MergeCartInput {
  sessionId: string;
}

// ─── Shipping config (hardcoded rates) ──────────────────────────
export const SHIPPING_CONFIG = {
  FREE_SHIPPING_THRESHOLD: 50000, // ₦50,000
  FLAT_RATE: 2500, // ₦2,500
} as const;
