/**
 * Order types for the backend.
 * Align with Prisma schema and frontend API contracts.
 */
import type { OrderStatus } from '../../generated/prisma';

// Re-export the Prisma enum for use in services
export { OrderStatus } from '../../generated/prisma';

// ─── Embedded address shape (stored as JSON in Order) ───────────
export interface ShippingAddress {
  firstName: string;
  lastName: string;
  phone: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

// ─── Order with items for API response ──────────────────────────
export interface OrderWithItems {
  id: string;
  orderNumber: string;
  userId: string;
  vendorId?: string | null;
  checkoutSessionId?: string | null;
  status: OrderStatus;
  items: OrderItemResponse[];
  shippingAddress?: ShippingAddress | null;
  billingAddress?: ShippingAddress | null;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  couponCode?: string | null;
  notes?: string | null;
  statusHistory: OrderStatusHistoryResponse[];
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
}

// ─── Order item response ────────────────────────────────────────
export interface OrderItemResponse {
  id: string;
  orderId: string;
  productId: string;
  variantId?: string | null;
  productName: string;
  productImage?: string | null;
  sku?: string | null;
  variantName?: string | null;
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
}

// ─── Order status history response ──────────────────────────────
export interface OrderStatusHistoryResponse {
  id: string;
  orderId: string;
  status: OrderStatus;
  note?: string | null;
  createdAt: Date;
}

// ─── Create order input ─────────────────────────────────────────
export interface CreateOrderInput {
  shippingAddress: ShippingAddress;
  billingAddress?: ShippingAddress;
  notes?: string;
}

// ─── Checkout validation result ─────────────────────────────────
export interface CheckoutValidationResult {
  valid: boolean;
  issues: string[];
  cart?: {
    items: Array<{
      productId: string;
      productName: string;
      quantity: number;
      available: number;
      price: number;
    }>;
    subtotal: number;
    shipping: number;
    total: number;
  };
}

// ─── Checkout session types ─────────────────────────────────────
export interface CheckoutIssue {
  productId: string;
  productName: string;
  reason: 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'INACTIVE' | 'PRICE_CHANGED';
  detail: string;
}

export interface VendorGroup {
  vendorId: string | null;
  storeName: string;
  items: Array<{
    productId: string;
    variantId: string | null;
    productName: string;
    image: string | null;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    type: string;
  }>;
  subtotal: number;
  shipping: number;
  total: number;
}

export interface CheckoutSessionPreview {
  snapshotToken: string;
  vendorGroups: VendorGroup[];
  issues: CheckoutIssue[];
  requiresShipping: boolean;
  summary: {
    orderCount: number;
    subtotal: number;
    shipping: number;
    discount: number;
    total: number;
    itemCount: number;
  };
}

export interface ConfirmCheckoutSessionInput {
  snapshotToken: string;
  shippingAddress?: ShippingAddress;
  billingAddress?: ShippingAddress;
  notes?: string;
}

export interface CheckoutSessionResult {
  checkoutSessionId: string;
  orders: Array<{
    id: string;
    orderNumber: string;
    vendorId: string | null;
    storeName: string;
    subtotal: number;
    shipping: number;
    total: number;
    itemCount: number;
  }>;
  summary: {
    orderCount: number;
    subtotal: number;
    shipping: number;
    total: number;
  };
}

// ─── Pagination for orders ──────────────────────────────────────
export interface OrdersPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedOrders {
  data: OrderWithItems[];
  pagination: OrdersPagination;
}
