import { z } from 'zod';

/**
 * Validate initialize payment request.
 */
export const initializePaymentSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;
