/**
 * Address types for the backend.
 * Align with Prisma schema and frontend API contracts.
 */

// ─── Address response ───────────────────────────────────────────
export interface AddressResponse {
  id: string;
  userId: string;
  label: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  street: string;
  apartment: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Limits ─────────────────────────────────────────────────────
export const ADDRESS_LIMITS = {
  MAX_PER_USER: 5,
} as const;

// ─── Nigerian states ────────────────────────────────────────────
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
  'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
  'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;
