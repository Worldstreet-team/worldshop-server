import prisma from '../../configs/prismaConfig';
import createError from 'http-errors';
import { OrderStatus, PaymentStatus } from '../../../generated/prisma';
import type { Payment, Prisma } from '../../../generated/prisma';
import type {
  InitPaymentResult,
  VerifyPaymentResult,
  WebhookResult,
  PaymentProviderType,
} from '../../types/payment.types';
import { getPaymentProvider } from './payment.service';
import { sendOrderReceipt, sendDigitalProductDelivery } from '../email.service';
import { createDownloadRecords } from '../download.service';
import { settleOrder } from '../ledger.write.service';
import { releaseExpiredCheckoutSessions } from '../checkout.service';
import { globalLog as logger } from '../../configs/loggerConfig';

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
    let digitalDownloads:
      | {
          fileName: string;
          fileSize: number;
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

async function getSessionOrders(checkoutSessionId: string) {
  return prisma.order.findMany({
    where: { checkoutSessionId },
    select: { id: true, orderNumber: true, status: true },
  });
}

async function markPaymentCompleted(
  payment: Payment,
  paidAt = new Date(),
): Promise<Array<{ id: string; orderNumber: string; status: OrderStatus }>> {
  if (!payment.checkoutSessionId) return [];

  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.COMPLETED,
        paidAt,
        providerData: {
          confirmedAt: paidAt.toISOString(),
          method: payment.provider,
        } as Prisma.InputJsonValue,
      },
    });

    if (updated.count === 0) return false;

    const orders = await tx.order.findMany({
      where: { checkoutSessionId: payment.checkoutSessionId! },
    });

    for (const order of orders) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID, paidAt },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: OrderStatus.PAID,
          note: 'Payment confirmed',
        },
      });
    }

    return true;
  });

  const orders = await prisma.order.findMany({
    where: { checkoutSessionId: payment.checkoutSessionId },
  });

  if (applied) {
    for (const order of orders) {
      void sendReceiptForOrder(
        payment.id,
        order.id,
        paidAt.toISOString(),
      ).catch((err) => {
        logger.error('[Email] Failed to send receipt for order', {
          orderId: order.id,
          error: (err as Error).message,
        });
      });

      if (order.vendorId) {
        try {
          await settleOrder(order.id);
        } catch (err) {
          logger.error(
            '[Ledger] CRITICAL — Failed to settle order. Manual resolution required.',
            {
              orderId: order.id,
              orderNumber: order.orderNumber,
              vendorId: order.vendorId,
              checkoutSessionId: payment.checkoutSessionId,
              error: (err as Error).message,
            },
          );
        }
      }
    }
  }

  return getSessionOrders(payment.checkoutSessionId);
}

async function markPaymentFailed(
  payment: Payment,
): Promise<Array<{ id: string; orderNumber: string; status: OrderStatus }>> {
  if (!payment.checkoutSessionId) return [];

  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.FAILED,
        providerData: {
          declinedAt: new Date().toISOString(),
          method: payment.provider,
        } as Prisma.InputJsonValue,
      },
    });

    if (updated.count === 0) return false;

    const orders = await tx.order.findMany({
      where: { checkoutSessionId: payment.checkoutSessionId! },
    });

    for (const order of orders) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
          note: 'Payment declined',
        },
      });

      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        include: { product: { select: { type: true } } },
      });

      for (const item of items) {
        if (item.product.type === 'DIGITAL') continue;
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    }

    return true;
  });

  if (!applied) {
    logger.info('[Payment] Skipped duplicate failed settlement', {
      paymentId: payment.id,
      checkoutSessionId: payment.checkoutSessionId,
    });
  }

  return getSessionOrders(payment.checkoutSessionId);
}

export async function initializePayment(
  userId: string,
  userEmail: string,
  checkoutSessionId: string,
  provider: PaymentProviderType = 'MOCK' as PaymentProviderType,
): Promise<InitPaymentResult> {
  await releaseExpiredCheckoutSessions();

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

  const existingPayment = await prisma.payment.findUnique({
    where: { checkoutSessionId },
  });

  if (existingPayment) {
    if (existingPayment.status === PaymentStatus.COMPLETED) {
      throw createError(400, 'This checkout session has already been paid for');
    }
    if (existingPayment.status === PaymentStatus.PENDING) {
      const paymentProvider = getPaymentProvider(existingPayment.provider as PaymentProviderType);
      const result = await paymentProvider.initializePayment({
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

  const paymentProvider = getPaymentProvider(provider);
  const result = await paymentProvider.initializePayment({
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
      provider,
      transactionRef: result.transactionRef,
    },
  });

  return result;
}

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

  const paymentProvider = getPaymentProvider(payment.provider as PaymentProviderType);

  if (payment.provider === 'MOCK') {
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
  }

  const providerResult = await paymentProvider.verifyPayment(transactionRef);

  let orders = payment.checkoutSessionId
    ? await getSessionOrders(payment.checkoutSessionId)
    : [];

  if (providerResult.status === 'success') {
    if (Math.abs(providerResult.amount - payment.amount) > 0.01) {
      throw createError(400, 'Payment amount does not match checkout total');
    }

    orders = await markPaymentCompleted(
      payment,
      providerResult.paidAt ? new Date(providerResult.paidAt) : new Date(),
    );
  } else if (providerResult.status === 'failed') {
    orders = await markPaymentFailed(payment);
  }

  return {
    ...providerResult,
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
    })),
  };
}

export async function handleWebhook(
  rawBody: string,
  signature: string,
  requestedProvider?: PaymentProviderType,
): Promise<WebhookResult> {
  let parsedBody: any;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return { status: 'ignored' };
  }

  const checkoutSessionId =
    parsedBody.checkoutSessionId || parsedBody.data?.meta?.checkoutSessionId;

  if (!checkoutSessionId) {
    return { status: 'ignored' };
  }

  const payment = await prisma.payment.findUnique({
    where: { checkoutSessionId },
  });

  if (!payment) {
    return { status: 'ignored' };
  }

  if (
    payment.status === PaymentStatus.COMPLETED ||
    payment.status === PaymentStatus.FAILED
  ) {
    return {
      status:
        payment.status === PaymentStatus.COMPLETED ? 'completed' : 'failed',
    };
  }

  const provider = requestedProvider
    ? getPaymentProvider(requestedProvider)
    : getPaymentProvider(payment.provider as PaymentProviderType);

  const providerResult = await provider.handleWebhook(rawBody, signature);

  if (providerResult.status === 'completed') {
    await markPaymentCompleted(payment);
    return { status: 'completed' };

  }

  if (providerResult.status === 'failed') {
    await markPaymentFailed(payment);
    return { status: 'failed' };
  }

  return { status: 'ignored' };
}
