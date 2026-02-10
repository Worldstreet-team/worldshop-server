import { z } from 'zod';

export const createReviewSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  title: z.string().max(150, 'Title must be 150 characters or less').optional(),
  comment: z.string().min(10, 'Comment must be at least 10 characters').max(2000, 'Comment must be 2000 characters or less'),
});

export const updateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().max(150).optional().nullable(),
  comment: z.string().min(10).max(2000).optional(),
});

export const reviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sortBy: z.enum(['newest', 'oldest', 'highest', 'lowest']).default('newest'),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ReviewsQueryInput = z.infer<typeof reviewsQuerySchema>;
