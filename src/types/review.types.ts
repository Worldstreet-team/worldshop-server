export interface ReviewResponse {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  rating: number;
  title: string | null;
  comment: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewSummary {
  averageRating: number;
  totalCount: number;
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export interface PaginatedReviews {
  data: ReviewResponse[];
  summary: ReviewSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
