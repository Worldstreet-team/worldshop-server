import prisma from '../configs/prismaConfig';
import { LedgerEntryType } from '../../generated/prisma';
import type {
  VendorBalanceSummary,
  VendorAnalyticsInput,
  VendorAnalyticsResult,
  EarningsBucket,
  CommissionReportInput,
  CommissionReportResult,
  LedgerEntryResponse,
} from '../types/ledger.types';

// ─── Vendor Balance ─────────────────────────────────────────────

export async function getVendorBalance(
  vendorId: string,
): Promise<VendorBalanceSummary> {
  const balance = await prisma.vendorBalance.findUnique({
    where: { vendorId },
  });

  return {
    vendorId,
    availableBalance: balance?.availableBalance ?? 0,
    totalEarned: balance?.totalEarned ?? 0,
    totalCommission: balance?.totalCommission ?? 0,
    updatedAt: balance?.updatedAt ?? new Date(),
  };
}

// ─── Vendor Ledger (earnings list) ──────────────────────────────

export async function getVendorLedger(
  vendorId: string,
  query: {
    type?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: 'asc' | 'desc';
  } = {},
): Promise<{ entries: LedgerEntryResponse[]; total: number }> {
  const where: Record<string, unknown> = { vendorId };

  if (query.type) {
    where.type = query.type as LedgerEntryType;
  }

  const dateFilter: Record<string, Date> = {};
  if (query.from) dateFilter.gte = new Date(query.from);
  if (query.to) dateFilter.lte = new Date(query.to);
  if (Object.keys(dateFilter).length > 0) {
    where.createdAt = dateFilter;
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: query.sort ?? 'desc' },
      skip,
      take: limit,
    }),
    prisma.ledgerEntry.count({ where }),
  ]);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      orderId: e.orderId,
      vendorId: e.vendorId,
      type: e.type,
      amount: e.amount,
      currency: e.currency,
      balanceBefore: e.balanceBefore,
      balanceAfter: e.balanceAfter,
      createdAt: e.createdAt,
    })),
    total,
  };
}

// ─── Vendor Analytics (dashboard summary) ───────────────────────

export async function getVendorAnalytics(
  input: VendorAnalyticsInput,
): Promise<VendorAnalyticsResult> {
  const { vendorId } = input;

  const dateFilter: Record<string, Date> = {};
  if (input.from) dateFilter.gte = new Date(input.from);
  if (input.to) dateFilter.lte = new Date(input.to);
  const createdAt =
    Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  // Count paid vendor orders in period
  const orderWhere: Record<string, unknown> = {
    vendorId,
    status: 'PAID',
  };
  if (createdAt) orderWhere.paidAt = createdAt;

  const totalOrders = await prisma.order.count({ where: orderWhere });

  // Sum ledger entries in period
  const entryWhere: Record<string, unknown> = { vendorId };
  if (createdAt) entryWhere.createdAt = createdAt;

  const saleEntries = await prisma.ledgerEntry.findMany({
    where: { ...entryWhere, type: LedgerEntryType.SALE },
    select: { amount: true },
  });
  const commissionEntries = await prisma.ledgerEntry.findMany({
    where: { ...entryWhere, type: LedgerEntryType.COMMISSION },
    select: { amount: true },
  });

  const totalNetRevenue = saleEntries.reduce((s, e) => s + e.amount, 0);
  const totalCommission = commissionEntries.reduce((s, e) => s + e.amount, 0);
  const totalSales = totalNetRevenue + totalCommission;

  // Current balance (independent of date filter)
  const balance = await getVendorBalance(vendorId);

  // Earnings over time
  const allSaleEntries = await prisma.ledgerEntry.findMany({
    where: { vendorId, type: LedgerEntryType.SALE, ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { amount: true, createdAt: true },
  });

  const allCommEntries = await prisma.ledgerEntry.findMany({
    where: { vendorId, type: LedgerEntryType.COMMISSION, ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { amount: true, createdAt: true },
  });

  const earningsOverTime = bucketEntries(allSaleEntries, allCommEntries, input.from, input.to);

  return {
    vendorId,
    period: {
      from: input.from ? new Date(input.from) : null,
      to: input.to ? new Date(input.to) : null,
    },
    summary: {
      totalOrders,
      totalSales: Math.round(totalSales * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      netRevenue: Math.round(totalNetRevenue * 100) / 100,
    },
    balance,
    earningsOverTime,
  };
}

// ─── Admin Commission Report ────────────────────────────────────

export async function getCommissionReport(
  input: CommissionReportInput = {},
): Promise<CommissionReportResult> {
  const dateFilter: Record<string, Date> = {};
  if (input.from) dateFilter.gte = new Date(input.from);
  if (input.to) dateFilter.lte = new Date(input.to);
  const createdAt =
    Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

  // Get commission rate
  const configEntry = await prisma.platformConfig.findUnique({
    where: { key: 'commissionRate' },
  });
  const commissionRate = configEntry ? parseFloat(configEntry.value as string) : 0.10;

  // All vendor balances
  const vendorBalances = await prisma.vendorBalance.findMany();

  // Get ledger entries for the period
  const entryWhere: Record<string, unknown> = {};
  if (createdAt) entryWhere.createdAt = createdAt;

  const saleEntries = await prisma.ledgerEntry.findMany({
    where: { ...entryWhere, type: LedgerEntryType.SALE },
  });
  const commissionEntries = await prisma.ledgerEntry.findMany({
    where: { ...entryWhere, type: LedgerEntryType.COMMISSION },
  });

  // Group by vendor
  const vendorMap = new Map<string, {
    totalSales: number;
    totalCommission: number;
    orderIds: Set<string>;
  }>();

  for (const entry of saleEntries) {
    const v = vendorMap.get(entry.vendorId) ?? {
      totalSales: 0,
      totalCommission: 0,
      orderIds: new Set<string>(),
    };
    v.totalSales += entry.amount;
    v.orderIds.add(entry.orderId);
    vendorMap.set(entry.vendorId, v);
  }

  for (const entry of commissionEntries) {
    const v = vendorMap.get(entry.vendorId) ?? {
      totalSales: 0,
      totalCommission: 0,
      orderIds: new Set<string>(),
    };
    v.totalCommission += entry.amount;
    v.orderIds.add(entry.orderId);
    vendorMap.set(entry.vendorId, v);
  }

  // Get vendor names
  const vendorIds = [...vendorMap.keys()];
  const vendorProfiles = vendorIds.length > 0
    ? await prisma.userProfile.findMany({
        where: { userId: { in: vendorIds } },
        select: { userId: true, storeName: true, firstName: true, lastName: true },
      })
    : [];
  const nameMap = new Map(
    vendorProfiles.map((p) => [p.userId, p.storeName || `${p.firstName} ${p.lastName}`]),
  );

  // Build per-vendor breakdown
  const vendors = [...vendorMap.entries()]
    .map(([vendorId, data]) => ({
      vendorId,
      vendorName: nameMap.get(vendorId) || 'Unknown Vendor',
      totalOrders: data.orderIds.size,
      totalSales: Math.round((data.totalSales + data.totalCommission) * 100) / 100,
      totalCommission: Math.round(data.totalCommission * 100) / 100,
      netRevenue: Math.round(data.totalSales * 100) / 100,
    }))
    .sort((a, b) => b.totalSales - a.totalSales);

  const platformTotalSales = vendors.reduce((s, v) => s + v.totalSales, 0);
  const platformTotalCommission = vendors.reduce((s, v) => s + v.totalCommission, 0);
  const platformTotalOrders = vendors.reduce((s, v) => s + v.totalOrders, 0);

  return {
    period: {
      from: input.from ? new Date(input.from) : null,
      to: input.to ? new Date(input.to) : null,
    },
    platform: {
      totalOrders: platformTotalOrders,
      totalSales: Math.round(platformTotalSales * 100) / 100,
      totalCommission: Math.round(platformTotalCommission * 100) / 100,
      netToVendors: Math.round((platformTotalSales - platformTotalCommission) * 100) / 100,
      commissionRate,
    },
    vendors,
  };
}

// ─── Helper: bucket entries by day ──────────────────────────────

function bucketEntries(
  saleEntries: { amount: number; createdAt: Date }[],
  commEntries: { amount: number; createdAt: Date }[],
  _from?: string,
  _to?: string,
): EarningsBucket[] {
  const buckets = new Map<string, { sales: number; commission: number }>();

  for (const entry of saleEntries) {
    const key = entry.createdAt.toISOString().slice(0, 10);
    const b = buckets.get(key) ?? { sales: 0, commission: 0 };
    b.sales += entry.amount;
    buckets.set(key, b);
  }

  for (const entry of commEntries) {
    const key = entry.createdAt.toISOString().slice(0, 10);
    const b = buckets.get(key) ?? { sales: 0, commission: 0 };
    b.commission += entry.amount;
    buckets.set(key, b);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      sales: Math.round(data.sales * 100) / 100,
      commission: Math.round(data.commission * 100) / 100,
      net: Math.round((data.sales - data.commission) * 100) / 100,
    }));
}
