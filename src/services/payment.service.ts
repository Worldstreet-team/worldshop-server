import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { randomUUID } from 'crypto';
import { OrderStatus, PaymentStatus } from '../../generated/prisma';
import type { Prisma } from '../../generated/prisma';
import { CLIENT_URL } from '../configs/envConfig';
import type {
  PaymentServiceInterface,
  InitPaymentParams,
  InitPaymentResult,
  VerifyPaymentResult,
  WebhookResult,
} from '../types/payment.types';
import { sendOrderReceipt, sendDigitalProductDelivery } from './email.service';
import { createDownloadRecords } from './download.service';
import { settleOrder } from './ledger.write.service';
import { globalLog as logger } from '../configs/loggerConfig';

// ─── Receipt helpers ────────────────────────────────────────────

/**
 * Send receipt for a paid order (deduped via per-order key in Payment metadata).
 */
async function sendReceiptForOrder(
  paymentId: string,
  orderId: string,
  paidAt: string,
  fallbackEmail?: string,
): Promise<void> {
  const paymentRecord = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!paymentRecord) return;

  // Dedupe check: per-order key in metadata
  const existingMeta =
    paymentRecord.metadata &&
    typeof paymentRecord.metadata === 'object' &&
    !Array.isArray(paymentRecord.metadata)
      ? (paymentRecord.metadata as Record<string, unknown>)
      : {};
  const orderReceiptKey = `receiptSent_${orderId}`;
  if (existingMeta[orderReceiptKey]) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: { product: { select: { type: true } } },
      },
    },
  });

  if (!order) return;

  const profile = await prisma.userProfile.findUnique({
    where: { userId: order.userId },
  });

  const shippingAddr = order.shippingAddress as {
    firstName: string;
    lastName: string;
    street: string;
    apartment?: string;
    city: string;
    state: string;
    country: string;
    phone: string;
  } | null;

  const customerEmail = profile?.email || fallbackEmail || '';
  if (!customerEmail) {
    logger.warn('[Email] Skipped receipt — no customer email found', {
      orderId: order.id,
      orderNumber: order.orderNumber,
    });
    return;
  }

  const customerName =
    profile?.firstName || shippingAddr?.firstName || 'Customer';

  const isDigitalOnly = order.items.every(
    (item) => item.product.type === 'DIGITAL',
  );

  if (isDigitalOnly) {
    const deliverySent = await handleDigitalDelivery(
      orderId,
      order.userId,
      customerEmail,
      customerName,
      order.orderNumber,
    );

    if (deliverySent) {
      void markOrderReceiptSent(paymentRecord.id, orderId, existingMeta);
    }
  } else {
    // Physical / mixed orders
    let digitalDownloads:
      | {
          fileName: string;
          fileSize: number;
          downloadUrl: string;
          maxDownloads: number;
          expiresAt: Date;
        }[]
      | undefined;

    const hasDigitalItems = order.items.some(
      (item) => item.product.type === 'DIGITAL',
    );

    if (hasDigitalItems) {
      try {
        try {
          await createDownloadRecords(orderId, order.userId);
        } catch (createErr) {
          logger.warn(
            '[Email] createDownloadRecords error (may be duplicate)',
            { orderId, error: (createErr as Error).message },
          );
        }

        const orderItemIds = (
          await prisma.orderItem.findMany({
            where: { orderId },
            select: { id: true },
          })
        ).map((i) => i.id);

        const downloads = await prisma.downloadRecord.findMany({
          where: { userId: order.userId, orderItemId: { in: orderItemIds } },
        });

        if (downloads.length > 0) {
          digitalDownloads = await Promise.all(
            downloads.map(async (dl) => {
              const asset = await prisma.digitalAsset.findUnique({
                where: { id: dl.assetId },
              });
              return {
                fileName: asset?.fileName || 'Unknown file',
                fileSize: asset?.fileSize || 0,
                downloadUrl: '',
                maxDownloads: dl.maxDownloads,
                expiresAt: dl.expiresAt,
              };
            }),
          );
        }
      } catch (err) {
        logger.error(
          '[Email] Failed to prepare digital downloads for receipt',
          { orderId, error: (err as Error).message },
        );
      }
    }

    void sendOrderReceipt({
      customerEmail,
      customerName,
      orderNumber: order.orderNumber,
      orderId: order.id,
      items: order.items.map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        productImage: item.productImage,
      })),
      subtotal: order.subtotal,
      shipping: order.shipping,
      discount: order.discount,
      total: order.total,
      paymentChannel: 'mock',
      paidAt,
      shippingAddress: shippingAddr!,
      digitalDownloads,
    }).then((sent) => {
      if (!sent) return;
      return markOrderReceiptSent(
        paymentRecord.id,
        orderId,
        existingMeta,
      );
    });
  }
}

function markOrderReceiptSent(
  paymentId: string,
  orderId: string,
  existingMetadata: Record<string, unknown>,
): Promise<void> {
  return prisma.payment
    .update({
      where: { id: paymentId },
      data: {
        metadata: {
          ...existingMetadata,
          [`receiptSent_${orderId}`]: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    })
    .then(() => {})
    .catch(() => {
      logger.warn('[Email] Failed to persist receiptSentAt metadata', {
        paymentId,
        orderId,
      });
    });
}

/**
 * Handle digital product delivery after payment.
 */
async function handleDigitalDelivery(
  orderId: string,
  userId: string,
  customerEmail: string,
  customerName: string,
  orderNumber: string,
): Promise<boolean> {
  try {
    try {
      await createDownloadRecords(orderId, userId);
      logger.info('[DigitalDelivery] Download records created', {
        orderId,
        orderNumber,
      });
    } catch (createErr) {
      logger.warn(
        '[DigitalDelivery] createDownloadRecords error (may be duplicate)',
        { orderId, error: (createErr as Error).message },
      );
    }

    const orderItemIds = (
      await prisma.orderItem.findMany({
        where: { orderId },
        select: { id: true },
      })
    ).map((i) => i.id);

    const downloads = await prisma.downloadRecord.findMany({
      where: { userId, orderItemId: { in: orderItemIds } },
    });

    if (downloads.length > 0) {
      const downloadInfo = await Promise.all(
        downloads.map(async (dl) => {
          const asset = await prisma.digitalAsset.findUnique({
            where: { id: dl.assetId },
          });
          return {
            fileName: asset?.fileName || 'Unknown file',
            fileSize: asset?.fileSize || 0,
            downloadId: dl.id,
            downloadUrl: '',
            maxDownloads: dl.maxDownloads,
            expiresAt: dl.expiresAt,
          };
        }),
      );

      return await sendDigitalProductDelivery({
        customerEmail,
        customerName,
        orderNumber,
        downloads: downloadInfo,
      });
    }

    return false;
  } catch (err) {
    logger.error('[DigitalDelivery] Failed to process digital delivery', {
      orderId,
      orderNumber,
      error: (err as Error).message,
    });
    return false;
  }
}

// ─── Reference generator ────────────────────────────────────────

function generateTransactionRef(): string {
  const uuid = randomUUID().replace(/-/g, '');
  return `WS-PAY-${uuid.slice(0, 16)}`;
}

// ─── Mock Payment Service ───────────────────────────────────────

const mockPaymentService: PaymentServiceInterface = {
  async initializePayment(
    params: InitPaymentParams,
  ): Promise<InitPaymentResult> {
    const transactionRef = generateTransactionRef();
    const clientUrl = CLIENT_URL || 'http://localhost:5173';
    const redirectUrl = `${clientUrl}/checkout/mock-payment?session=${params.checkoutSessionId}&ref=${transactionRef}`;

    return {
      transactionRef,
      action: { type: 'redirect', url: redirectUrl },
    };
  },

  async verifyPayment(transactionRef: string): Promise<VerifyPaymentResult> {
    const payment = await prisma.payment.findUnique({
      where: { transactionRef },
    });

    if (!payment) {
      throw createError(404, 'Payment not found');
    }

    const orders = payment.checkoutSessionId
      ? await prisma.order.findMany({
          where: { checkoutSessionId: payment.checkoutSessionId },
          select: { id: true, orderNumber: true, status: true },
        })
      : [];

    return {
      status:
        payment.status === PaymentStatus.COMPLETED
          ? 'success'
          : payment.status === PaymentStatus.FAILED
            ? 'failed'
            : 'pending',
      transactionRef: payment.transactionRef || transactionRef,
      amount: payment.amount,
      paidAt: payment.paidAt?.toISOString() || '',
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
      })),
    };
  },

  async handleWebhook(
    rawBody: string,
    _signature: string,
  ): Promise<WebhookResult> {
    let body: { checkoutSessionId: string; action: 'confirm' | 'decline' };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { status: 'ignored' };
    }

    const { checkoutSessionId, action } = body;
    if (!checkoutSessionId || !action) {
      return { status: 'ignored' };
    }

    const payment = await prisma.payment.findUnique({
      where: { checkoutSessionId },
    });

    if (!payment) {
      return { status: 'ignored' };
    }

    // Idempotent — already processed
    if (
      payment.status === PaymentStatus.COMPLETED ||
      payment.status === PaymentStatus.FAILED
    ) {
      return {
        status:
          payment.status === PaymentStatus.COMPLETED ? 'completed' : 'failed',
      };
    }

    const orders = await prisma.order.findMany({
      where: { checkoutSessionId },
    });

    if (action === 'confirm') {
      const paidAt = new Date();

      await prisma.$transaction([
        prisma.payment.update({
          where: { checkoutSessionId },
          data: {
            status: PaymentStatus.COMPLETED,
            paidAt,
            providerData: {
              confirmedAt: paidAt.toISOString(),
              method: 'mock',
            } as Prisma.InputJsonValue,
          },
        }),
        ...orders.flatMap((order) => [
          prisma.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.PAID, paidAt },
          }),
          prisma.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: OrderStatus.PAID,
              note: 'Payment confirmed via mock payment',
            },
          }),
        ]),
      ]);

      // Send receipts for each order (non-blocking)
      for (const order of orders) {
        void sendReceiptForOrder(
          payment.id,
          order.id,
          paidAt.toISOString(),
        );
      }

      // Settle commission for vendor orders (non-blocking, idempotent)
      for (const order of orders) {
        if (order.vendorId) {
          void settleOrder(order.id).catch((err) => {
            logger.error('[Ledger] Failed to settle order', {
              orderId: order.id,
              error: (err as Error).message,
            });
          });
        }
      }

      return { status: 'completed' };
    }

    if (action === 'decline') {
      await prisma.$transaction([
        prisma.payment.update({
          where: { checkoutSessionId },
          data: {
            status: PaymentStatus.FAILED,
            providerData: {
              declinedAt: new Date().toISOString(),
              method: 'mock',
            } as Prisma.InputJsonValue,
          },
        }),
        ...orders.flatMap((order) => [
          prisma.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.CANCELLED },
          }),
          prisma.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
              note: 'Payment declined via mock payment',
            },
          }),
        ]),
      ]);

      // Restore stock for declined orders
      for (const order of orders) {
        const items = await prisma.orderItem.findMany({
          where: { orderId: order.id },
          include: { product: { select: { type: true } } },
        });
        for (const item of items) {
          if (item.product.type === 'DIGITAL') continue;
          if (item.variantId) {
            await prisma.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          } else {
            await prisma.product.update({
              where: { id: item.productId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }
      }

      return { status: 'failed' };
    }

    return { status: 'ignored' };
  },
};

// ─── Exported payment service (swap for crypto later) ───────────

export const paymentService: PaymentServiceInterface = mockPaymentService;

// ─── High-level functions used by controllers ───────────────────

/**
 * Initialize payment for a checkout session.
 * Creates a Payment record and returns the redirect action.
 */
export async function initializePayment(
  userId: string,
  userEmail: string,
  checkoutSessionId: string,
): Promise<InitPaymentResult> {
  const orders = await prisma.order.findMany({
    where: { checkoutSessionId, userId },
  });

  if (orders.length === 0) {
    throw createError(404, 'Checkout session not found');
  }

  const allCreated = orders.every((o) => o.status === OrderStatus.CREATED);
  if (!allCreated) {
    throw createError(400, 'Checkout session is not in a payable state');
  }

  // Check for existing pending payment
  const existingPayment = await prisma.payment.findUnique({
    where: { checkoutSessionId },
  });

  if (existingPayment) {
    if (existingPayment.status === PaymentStatus.COMPLETED) {
      throw createError(400, 'This checkout session has already been paid for');
    }
    if (existingPayment.status === PaymentStatus.PENDING) {
      const result = await paymentService.initializePayment({
        checkoutSessionId,
        userId,
        userEmail,
        amount: existingPayment.amount,
        currency: existingPayment.currency,
      });
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: { transactionRef: result.transactionRef },
      });
      return result;
    }
  }

  const totalAmount = orders.reduce((sum, o) => sum + o.total, 0);

  const result = await paymentService.initializePayment({
    checkoutSessionId,
    userId,
    userEmail,
    amount: totalAmount,
    currency: 'NGN',
    metadata: {
      orderCount: orders.length,
      orderNumbers: orders.map((o) => o.orderNumber),
    },
  });

  await prisma.payment.create({
    data: {
      checkoutSessionId,
      userId,
      amount: totalAmount,
      currency: 'NGN',
      status: PaymentStatus.PENDING,
      provider: 'mock',
      transactionRef: result.transactionRef,
    },
  });

  return result;
}

/**
 * Verify a payment by transaction reference.
 */
export async function verifyPayment(
  userId: string,
  transactionRef: string,
): Promise<VerifyPaymentResult> {
  const payment = await prisma.payment.findUnique({
    where: { transactionRef },
  });

  if (!payment) {
    throw createError(404, 'Payment not found');
  }

  if (payment.userId !== userId) {
    throw createError(403, 'Not authorized to verify this payment');
  }

  return paymentService.verifyPayment(transactionRef);
}

/**
 * Handle a webhook from the payment provider.
 */
export async function handleWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookResult> {
  return paymentService.handleWebhook(rawBody, signature);
}
