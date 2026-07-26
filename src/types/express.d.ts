import { Request } from 'express';

export interface JwtPayload {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'ADMIN';
  isVendor: boolean;
  vendorStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | null;
}

/** Set by requireStore — the caller's own store. */
export interface StoreContext {
  id: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'BANNED';
  state: string;
  city: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      store?: StoreContext;
    }
  }
}
