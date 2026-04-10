import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { LedgerEntryType } from '../../generated/prisma';
import type { SettleOrderResult } from '../types/ledger.types';
import { globalLog as logger } from '../configs/loggerConfig';

/**
 * Settle commission for a paid vendor order.
 *
 * - Reads order.total + vendorId from DB (caller can't pass wrong amounts)
 * - Creates SALE + COMMISSION ledger entries atomically
 * - Updates VendorBalance
 * - Idempotent: duplicate calls return wasAlreadySettled = true
 */
export async function settleOrder(orderId: string): Promise<SettleOrderResult> {
  // Check if already settled (idempotency)
  const existing = await prisma.ledgerEntry.findFirst({
    where: { orderId, type: LedgerEntryType.SALE },
  });

  if (existing) {
    const commissionEntry = await prisma.ledgerEntry.findFirst({
      where: { orderId, type: LedgerEntryType.COMMISSION },
    });
    const balance = await prisma.vendorBalance.findUnique({
      where: { vendorId: existing.vendorId },
    });

    return {
      transactionId: existing.id,
      orderId,
      vendorId: existing.vendorId,
      grossSale: existing.amount + (commissionEntry?.amount ?? 0),
      commission: commissionEntry?.amount ?? 0,
      vendorNet: existing.amount,
      newAvailableBalance: balance?.availableBalance ?? 0,
      wasAlreadySettled: true,
    };
  }

  // Load order
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw createError(404, `Order ${orderId} not found`);
  }

  if (!order.vendorId) {
    throw createError(400, 'Cannot settle commission for platform-owned orders');
  }

  if (order.status !== 'PAID') {
    throw createError(400, `Order ${orderId} is not in PAID status (current: ${order.status})`);
  }

  // Load commission rate from PlatformConfig
  const configEntry = await prisma.platformConfig.findUnique({
    where: { key: 'commissionRate' },
  });
  const commissionRate = configEntry ? parseFloat(configEntry.value) : 0.10;

  const grossSale = order.total;
  const commission = Math.round(grossSale * commissionRate * 100) / 100;
  const vendorNet = Math.round((grossSale - commission) * 100) / 100;

  // Atomically create entries + update balance
  const result = await prisma.$transaction(async (tx) => {
    // Get or create vendor balance
    let balance = await tx.vendorBalance.findUnique({
      where: { vendorId: order.vendorId! },
    });

    const balanceBefore = balance?.availableBalance ?? 0;

    // Create SALE entry (vendor earnings)
    const saleEntry = await tx.ledgerEntry.create({
      data: {
        orderId,
        vendorId: order.vendorId!,
        type: LedgerEntryType.SALE,
        amount: vendorNet,
        balanceBefore,
        balanceAfter: balanceBefore + vendorNet,
      },
    });

    // Create COMMISSION entry (platform fee)
    await tx.ledgerEntry.create({
      data: {
        orderId,
        vendorId: order.vendorId!,
        type: LedgerEntryType.COMMISSION,
        amount: commission,
        balanceBefore,
        balanceAfter: balanceBefore + vendorNet,
      },
    });

    // Upsert vendor balance
    balance = await tx.vendorBalance.upsert({
      where: { vendorId: order.vendorId! },
      create: {
        vendorId: order.vendorId!,
        availableBalance: vendorNet,
        totalEarned: vendorNet,
        totalCommission: commission,
      },
      update: {
        availableBalance: { increment: vendorNet },
        totalEarned: { increment: vendorNet },
        totalCommission: { increment: commission },
      },
    });

    return {
      transactionId: saleEntry.id,
      newAvailableBalance: balance.availableBalance,
    };
  }, { timeout: 15000 });

  logger.info('[Ledger] Order settled', {
    orderId,
    vendorId: order.vendorId,
    grossSale,
    commission,
    vendorNet,
  });

  return {
    transactionId: result.transactionId,
    orderId,
    vendorId: order.vendorId,
    grossSale,
    commission,
    vendorNet,
    newAvailableBalance: result.newAvailableBalance,
    wasAlreadySettled: false,
  };
}
