export interface WishlistItemResponse {
  id: string;
  wishlistId: string;
  productId: string;
  product: {
    id: string;
    name: string;
    slug: string;
    basePrice: number;
    salePrice: number | null;
    images: Array<{ url: string; alt: string }>;
    stock: number;
  };
  addedAt: Date;
}

export interface WishlistResponse {
  id: string;
  userId: string;
  items: WishlistItemResponse[];
  createdAt: Date;
  updatedAt: Date;
}
