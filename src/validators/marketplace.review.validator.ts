import { z } from 'zod';

export const createReviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be 1-5').max(5, 'Rating must be 1-5'),
  title: z.string().trim().max(120).optional(),
  comment: z
    .string()
    .trim()
    .min(10, 'Write at least a sentence so the review is useful')
    .max(2000),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  comment: z.string().trim().min(10).max(2000).optional(),
});

export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

export const vendorReplySchema = z.object({
  reply: z
    .string()
    .trim()
    .min(2, 'Write a reply before posting')
    .max(1000, 'Replies are limited to 1000 characters'),
});

export type VendorReplyInput = z.infer<typeof vendorReplySchema>;

export const reviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  verifiedOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type ReviewQueryInput = z.infer<typeof reviewQuerySchema>;

export const reviewStatusSchema = z.object({
  status: z.enum(['PUBLISHED', 'FLAGGED', 'REMOVED']),
});

export type ReviewStatusInput = z.infer<typeof reviewStatusSchema>;
