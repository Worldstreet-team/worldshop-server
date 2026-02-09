import { z } from 'zod';
import { NIGERIAN_STATES } from '../types/address.types';

// ─── Create address ─────────────────────────────────────────────
export const createAddressSchema = z.object({
  label: z.string().max(30, 'Label must be 30 characters or less').optional(),
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  phone: z.string().min(7, 'Phone number is too short').max(20),
  street: z.string().min(1, 'Street address is required').max(200),
  apartment: z.string().max(100).optional(),
  city: z.string().min(1, 'City is required').max(100),
  state: z.enum(NIGERIAN_STATES, { message: 'Please select a valid Nigerian state' }),
  country: z.string().default('Nigeria'),
  postalCode: z.string().max(10).optional(),
  isDefault: z.boolean().optional(),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

// ─── Update address ─────────────────────────────────────────────
export const updateAddressSchema = createAddressSchema.partial();

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
