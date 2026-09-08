import { z } from 'zod';

const email = z
  .email('Enter a valid email address')
  .max(200)
  .transform((value) => value.trim().toLowerCase());

// 8 is the floor, not a recommendation. Composition rules (a digit, a symbol)
// are deliberately absent — they push people toward predictable substitutions
// without adding real entropy.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer');

const linkToken = z.string().min(20, 'Invalid link').max(200);

export const authAdminLoginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const authForgotPasswordSchema = z.object({ email });

export const authResetPasswordSchema = z.object({ token: linkToken, password });

export const authSetupPasswordSchema = z.object({ token: linkToken, password });

export type AuthAdminLoginInput = z.infer<typeof authAdminLoginSchema>;
export type AuthForgotPasswordInput = z.infer<typeof authForgotPasswordSchema>;
export type AuthResetPasswordInput = z.infer<typeof authResetPasswordSchema>;
export type AuthSetupPasswordInput = z.infer<typeof authSetupPasswordSchema>;
