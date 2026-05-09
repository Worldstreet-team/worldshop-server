import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import { LedgerEntryType, WithdrawalRequestStatus } from '../../generated/prisma';
import { buildPagination } from '../utils/pagination';
import type { WithdrawalRequestInput, VendorWithdrawalListInput } from '../validators/vendor.validator';
import type { AdminWithdrawalListInput, AdminWithdrawalStatusInput } from '../validators/admin.vendor.validator';

const ACTIVE_REQUEST_STATUSES: WithdrawalRequestStatus[] = [
  WithdrawalRequestStatus.PENDING,
  WithdrawalRequestStatus.APPROVED,
];

function ensureCanReject(status: WithdrawalRequestStatus) {
  if (!ACTIVE_REQUEST_STATUSES.includes(status)) {
    throw createError(400, `Cannot reject a withdrawal request that is ${status}`);
  }
}

function ensureCanApprove(status: WithdrawalRequestStatus) {
  if (status !== WithdrawalRequestStatus.PENDING) {
    throw createError(400, `Only pending withdrawal requests can be approved`);
  }
}

function ensureCanMarkPaid(status: WithdrawalRequestStatus) {
  if (!ACTIVE_REQUEST_STATUSES.includes(status)) {
    throw createError(400, `Cannot mark a withdrawal request that is ${status} as paid`);
  }
}

export async function createWithdrawalRequest(vendorId: string, input: WithdrawalRequestInput) {
  const account = await prisma.vendorWithdrawalAccount.findFirst({
    where: {
      vendorId,
      ...(input.accountId ? { id: input.accountId } : {}),
    },
  });

  if (!account) {
    throw createError(400, 'Add a withdrawal account before requesting a payout');
  }

  if (!account.isVerified) {
    throw createError(400, 'Withdrawal account must be verified before requesting a payout');
  }

  const result = await prisma.$transaction(async (tx) => {
    const balance = await tx.vendorBalance.findUnique({
      where: { vendorId },
    });

    const balanceBefore = balance?.availableBalance ?? 0;

    if (balanceBefore < input.amount) {
      throw createError(400, 'Insufficient available balance for this withdrawal');
    }

    const request = await tx.vendorWithdrawalRequest.create({
      data: {
        vendorId,
        accountId: account.id,
        amount: input.amount,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        vendorNote: input.vendorNote?.trim() || null,
      },
    });

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        orderId: request.id,
        vendorId,
        type: LedgerEntryType.WITHDRAWAL,
        amount: -input.amount,
        balanceBefore,
        balanceAfter: balanceBefore - input.amount,
      },
    });

    await tx.vendorBalance.update({
      where: { vendorId },
      data: {
        availableBalance: { decrement: input.amount },
      },
    });

    return tx.vendorWithdrawalRequest.update({
      where: { id: request.id },
      data: { ledgerEntryId: ledgerEntry.id },
    });
  }, { timeout: 15000 });

  return result;
}

export async function listVendorWithdrawalRequests(vendorId: string, query: VendorWithdrawalListInput) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;
  const where = {
    vendorId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [requests, total] = await Promise.all([
    prisma.vendorWithdrawalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.vendorWithdrawalRequest.count({ where }),
  ]);

  return {
    data: requests,
    pagination: buildPagination(total, page, limit),
  };
}

export async function listAdminWithdrawalRequests(query: AdminWithdrawalListInput) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.vendorId ? { vendorId: query.vendorId } : {}),
  };

  const [requests, total] = await Promise.all([
    prisma.vendorWithdrawalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.vendorWithdrawalRequest.count({ where }),
  ]);

  const vendorIds = [...new Set(requests.map((request) => request.vendorId))];
  const vendors = await prisma.userProfile.findMany({
    where: { userId: { in: vendorIds } },
    select: {
      userId: true,
      email: true,
      firstName: true,
      lastName: true,
      storeName: true,
    },
  });
  const vendorMap = new Map(vendors.map((vendor) => [vendor.userId, vendor]));

  return {
    data: requests.map((request) => ({
      ...request,
      vendor: vendorMap.get(request.vendorId) ?? null,
    })),
    pagination: buildPagination(total, page, limit),
  };
}

export async function getAdminWithdrawalRequest(id: string) {
  const request = await prisma.vendorWithdrawalRequest.findUnique({
    where: { id },
  });

  if (!request) {
    throw createError(404, 'Withdrawal request not found');
  }

  const [vendor, balance] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId: request.vendorId },
      select: {
        userId: true,
        email: true,
        firstName: true,
        lastName: true,
        storeName: true,
      },
    }),
    prisma.vendorBalance.findUnique({
      where: { vendorId: request.vendorId },
    }),
  ]);

  return {
    ...request,
    vendor,
    balance,
  };
}

export async function updateWithdrawalRequestStatus(
  id: string,
  adminUserId: string,
  input: AdminWithdrawalStatusInput,
) {
  const note = input.adminNote?.trim() || null;

  return prisma.$transaction(async (tx) => {
    const request = await tx.vendorWithdrawalRequest.findUnique({
      where: { id },
    });

    if (!request) {
      throw createError(404, 'Withdrawal request not found');
    }

    if (input.status === WithdrawalRequestStatus.APPROVED) {
      ensureCanApprove(request.status);

      return tx.vendorWithdrawalRequest.update({
        where: { id },
        data: {
          status: WithdrawalRequestStatus.APPROVED,
          adminNote: note,
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
        },
      });
    }

    if (input.status === WithdrawalRequestStatus.PAID) {
      ensureCanMarkPaid(request.status);

      return tx.vendorWithdrawalRequest.update({
        where: { id },
        data: {
          status: WithdrawalRequestStatus.PAID,
          adminNote: note,
          reviewedBy: request.reviewedBy ?? adminUserId,
          reviewedAt: request.reviewedAt ?? new Date(),
          paidAt: new Date(),
        },
      });
    }

    ensureCanReject(request.status);

    const balance = await tx.vendorBalance.findUnique({
      where: { vendorId: request.vendorId },
    });
    const balanceBefore = balance?.availableBalance ?? 0;

    await tx.ledgerEntry.create({
      data: {
        orderId: request.id,
        vendorId: request.vendorId,
        type: LedgerEntryType.WITHDRAWAL_REVERSAL,
        amount: request.amount,
        balanceBefore,
        balanceAfter: balanceBefore + request.amount,
      },
    });

    await tx.vendorBalance.upsert({
      where: { vendorId: request.vendorId },
      create: {
        vendorId: request.vendorId,
        availableBalance: request.amount,
      },
      update: {
        availableBalance: { increment: request.amount },
      },
    });

    return tx.vendorWithdrawalRequest.update({
      where: { id },
      data: {
        status: WithdrawalRequestStatus.REJECTED,
        adminNote: note,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
      },
    });
  }, { timeout: 15000 });
}
