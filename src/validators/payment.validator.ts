import { z } from 'zod';

/**
 * Validate webhook request body.
 */
export const webhookBodySchema = z.object({
  checkoutSessionId: z.string().min(1, 'checkoutSessionId is required'),
  action: z.enum(['confirm', 'decline']),
});

export type WebhookBodyInput = z.infer<typeof webhookBodySchema>;
