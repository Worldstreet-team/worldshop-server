/**
 * Store credit — prepaid subscription value held on the platform.
 *
 * Two sources: balances migrated from the pre-pivot commission model (money
 * the platform already owed vendors) and admin grants. It is spent before the
 * vendor's wallet is touched, and it is not withdrawable: it exists to pay for
 * visibility, not as a stored-value account.
 *
 * `Store.creditMinor` is the working balance; `StoreCreditEntry` is the audit
 * trail behind it. Both move in the same transaction, so the balance can
 * always be re-derived from the entries — important, because this is money the
 * platform owes and a bare integer would be unauditable.
 */
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { globalLog as logger } from '../configs/loggerConfig';
import type { StoreCreditEntryType } from '../../generated/prisma';

export type CreditMovement = {
  applied: boolean;
  amountMinor: number;
  balanceAfter: number;
};

/**
 * Moves credit and records it atomically.
 *
 * `reference` makes this idempotent: a replayed grant or a retried
 * subscription debit collides on the unique index and is reported as
 * `applied: false` rather than moving money a second time.
 *
 * Debits are clamped at the available balance by the caller — this function
 * refuses to write a negative balance rather than silently allowing an
 * overdraft on credit the platform never issued.
 */
export async function recordCredit(opts: {
  storeId: string;
  type: StoreCreditEntryType;
  /** Positive to credit, negative to debit. */
  amountMinor: number;
  reference: string;
  note?: string;
}): Promise<CreditMovement> {
  if (opts.amountMinor === 0) {
    throw createError(400, 'Credit movement must be non-zero');
  }

  const existing = await prisma.storeCreditEntry.findUnique({
    where: { reference: opts.reference },
  });
  if (existing) {
    return { applied: false, amountMinor: existing.amountMinor, balanceAfter: existing.balanceAfter };
  }

  const store = await prisma.store.findUnique({
    where: { id: opts.storeId },
    select: { creditMinor: true },
  });
  if (!store) throw createError(404, 'Store not found');

  const balanceBefore = store.creditMinor;
  const balanceAfter = balanceBefore + opts.amountMinor;
  if (balanceAfter < 0) {
    throw createError(409, 'Insufficient store credit');
  }

  try {
    await prisma.$transaction([
      prisma.storeCreditEntry.create({
        data: {
          storeId: opts.storeId,
          type: opts.type,
          amountMinor: opts.amountMinor,
          balanceBefore,
          balanceAfter,
          reference: opts.reference,
          note: opts.note,
        },
      }),
      prisma.store.update({
        where: { id: opts.storeId },
        data: { creditMinor: { increment: opts.amountMinor } },
      }),
    ]);
  } catch (err) {
    // Two concurrent callers with the same reference: the loser sees the
    // unique-index violation and reports "already applied", which is correct.
    if ((err as { code?: string }).code === 'P2002') {
      return { applied: false, amountMinor: opts.amountMinor, balanceAfter: balanceBefore };
    }
    throw err;
  }

  logger.info('[StoreCredit] Recorded', {
    storeId: opts.storeId,
    type: opts.type,
    amountMinor: opts.amountMinor,
    balanceAfter,
  });

  return { applied: true, amountMinor: opts.amountMinor, balanceAfter };
}

export async function getCreditBalance(storeId: string): Promise<number> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { creditMinor: true },
  });
  return store?.creditMinor ?? 0;
}

export async function listCreditEntries(storeId: string, take = 50) {
  return prisma.storeCreditEntry.findMany({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}
