import { z } from 'zod';

export const adminUserListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  role: z.enum(['CUSTOMER', 'ADMIN']).optional(),
  // true: owns a personal store; false: does not. Query strings are text, so
  // z.coerce.boolean would read "false" as true.
  vendor: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const adminUserRoleSchema = z.object({
  role: z.enum(['CUSTOMER', 'ADMIN']),
});

export type AdminUserListInput = z.infer<typeof adminUserListSchema>;
export type AdminUserRoleInput = z.infer<typeof adminUserRoleSchema>;
