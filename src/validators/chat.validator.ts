import { z } from 'zod';

export const startConversationSchema = z.object({
  listingId: z.string().length(24, 'A valid listingId is required'),
  message: z
    .string()
    .trim()
    .min(2, 'Write a message before sending')
    .max(2000, 'Messages are limited to 2000 characters'),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message before sending')
    .max(2000, 'Messages are limited to 2000 characters'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const conversationQuerySchema = z.object({
  // A user can be both a buyer and a vendor, so the inbox side is explicit.
  side: z.enum(['buying', 'selling']).default('buying'),
  status: z.enum(['OPEN', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ConversationQueryInput = z.infer<typeof conversationQuerySchema>;

export const messageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type MessageQueryInput = z.infer<typeof messageQuerySchema>;
