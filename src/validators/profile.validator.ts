import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .min(2, 'First name must be at least 2 characters')
    .max(50, 'First name must be at most 50 characters')
    .optional(),
  lastName: z
    .string()
    .min(2, 'Last name must be at least 2 characters')
    .max(50, 'Last name must be at most 50 characters')
    .optional(),
  phone: z
    .string()
    .min(7, 'Phone number must be at least 7 characters')
    .max(20, 'Phone number must be at most 20 characters')
    .optional()
    .nullable(),
  avatar: z
    .string()
    .url('Avatar must be a valid URL')
    .optional()
    .nullable(),
  dateOfBirth: z
    .string()
    .datetime({ message: 'Date of birth must be a valid ISO date' })
    .optional()
    .nullable(),
  gender: z
    .enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'])
    .optional()
    .nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
