/**
 * Ledger / Commission System types.
 * Align with Prisma schema (LedgerEntry, VendorBalance, PlatformConfig).
 *
 * Design: Order-Aware (Design C from plan)
 *   Write: settleOrder(orderId) — reads order.total + vendorId from DB
 *   Read:  getVendorBalance(), getVendorLedger(), getCommissionReport()
 *   CQRS-lite: ledger.write.service / ledger.read.service
 */

// ─── Prisma enum re-export ──────────────────────────────────────

export { LedgerEntryType } from '../../generated/prisma';

// ─── SettleOrder output ─────────────────────────────────────────

/** Result of settling commission for a paid vendor order. */
export interface SettleOrderResult {
  transactionId: string;
  orderId: string;
  vendorId: string;
  grossSale: number;
  commission: number;
  vendorNet: number;
  newAvailableBalance: number;
  wasAlreadySettled: boolean;
}

// ─── Vendor balance ─────────────────────────────────────────────

export interface VendorBalanceSummary {
  vendorId: string;
  availableBalance: number;
  totalEarned: number;
  totalCommission: number;
  updatedAt: Date;
}

// ─── Vendor analytics ───────────────────────────────────────────

export interface VendorAnalyticsInput {
  vendorId: string;
  /** ISO date string, inclusive. Omit for all-time. */
  from?: string;
  /** ISO date string, inclusive. Omit for all-time. */
  to?: string;
}

export interface VendorAnalyticsResult {
  vendorId: string;
  period: { from: Date | null; to: Date | null };
  /** Aggregate numbers for the period. */
  summary: {
    totalOrders: number;
    totalSales: number;      // gross revenue (kobo)
    totalCommission: number;  // platform cut (kobo)
    netRevenue: number;       // totalSales − totalCommission (kobo)
  };
  /** Current balance (independent of date filter). */
  balance: VendorBalanceSummary;
  /** Time-bucketed earnings for chart rendering.
   *  Backend picks bucket size (day/week/month) based on range width. */
  earningsOverTime: EarningsBucket[];
}

export interface EarningsBucket {
  /** Start of the bucket (ISO string). */
  date: string;
  sales: number;
  commission: number;
  net: number;
}

// ─── Admin commission report ────────────────────────────────────

export interface CommissionReportInput {
  /** ISO date string, inclusive. Omit for all-time. */
  from?: string;
  /** ISO date string, inclusive. Omit for all-time. */
  to?: string;
}

export interface CommissionReportResult {
  period: { from: Date | null; to: Date | null };
  /** Platform-wide totals. */
  platform: {
    totalOrders: number;
    totalSales: number;
    totalCommission: number;
    netToVendors: number;
    commissionRate: number; // e.g. 0.10
  };
  /** Per-vendor breakdown, sorted by totalSales descending. */
  vendors: VendorCommissionBreakdown[];
}

export interface VendorCommissionBreakdown {
  vendorId: string;
  /** Vendor display name (joined from UserProfile). */
  vendorName: string;
  totalOrders: number;
  totalSales: number;
  totalCommission: number;
  netRevenue: number;
}

// ─── Ledger entry (for direct queries / debugging) ──────────────

export interface LedgerEntryResponse {
  id: string;
  orderId: string;
  vendorId: string;
  type: LedgerEntryType;
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
}
