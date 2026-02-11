import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { randomUUID } from 'crypto';
import { OrderStatus, PaymentStatus } from '../../generated/prisma';
import type { Prisma } from '../../generated/prisma';
import { CLIENT_URL } from '../configs/envConfig';
import {
  initializeTransaction,
  verifyTransaction,
} from '../configs/paystackConfig';
import type {
  InitializePaymentResult,
  VerifyPaymentResult,
  PaystackWebhookEvent,
} from '../types/payment.types';
import { sendOrderReceipt, sendDigitalProductDelivery } from './email.service';
import { createDownloadRecords } from './download.service';
import { signR2Key } from '../utils/signUrl';
import { globalLog as logger } from '../configs/loggerConfig';

type ReceiptMetadata = {
  receiptSentAt?: string;
};

function getReceiptMetadata(metadata: unknown): ReceiptMetadata {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as ReceiptMetadata;
  }
  return {};
}

function withReceiptSentAt(metadata: unknown): Record<string, unknown> {
  const base = getReceiptMetadata(metadata) as Record<string, unknown>;
  return {
    ...base,
    receiptSentAt: new Date().toISOString(),
  };
}

async function sendReceiptIfNeeded(
  paymentId: string,
  orderId: string,
  paidAt: string,
  paymentChannel: string,
  fallbackEmail?: string
): Promise<void> {
  const paymentRecord = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!paymentRecord) {
    return;
  }

  const meta = getReceiptMetadata(paymentRecord.metadata);
  if (meta.receiptSentAt) {
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: { product: { select: { type: true } } },
      },
    },
  });

  if (!order) {
    return;
  }

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

  const customerName = profile?.firstName || shippingAddr?.firstName || 'Customer';

  // Check if this order contains only digital products
  const isDigitalOnly = order.items.every(
    (item) => item.product.type === 'DIGITAL'
  );

  if (isDigitalOnly) {
    // For digital-only orders, send only the digital delivery email
    const deliverySent = await handleDigitalDelivery(
      orderId,
      order.userId,
      customerEmail,
      customerName,
      order.orderNumber
    );

    if (deliverySent) {
      // Mark receipt as sent to prevent duplicates
      void prisma.payment.update({
        where: { id: paymentRecord.id },
        data: {
          metadata: withReceiptSentAt(paymentRecord.metadata) as Prisma.InputJsonValue,
        },
      }).catch(() => {
        logger.warn('[Email] Failed to persist receiptSentAt metadata', {
          paymentId: paymentRecord.id,
        });
      });
    } else {
      logger.warn('[DigitalDelivery] Email not sent; receipt not marked', {
        orderId,
        orderNumber: order.orderNumber,
      });
    }
  } else {
    // For physical/mixed orders: create download records first, then include links in the receipt
    let digitalDownloads: {
      fileName: string;
      fileSize: number;
      downloadUrl: string;
      maxDownloads: number;
      expiresAt: Date;
    }[] | undefined;

    const hasDigitalItems = order.items.some((item) => item.product.type === 'DIGITAL');

    if (hasDigitalItems) {
      try {
        try {
          await createDownloadRecords(orderId, order.userId);
        } catch (createErr) {
          logger.warn('[Email] createDownloadRecords error (may be duplicate)', {
            orderId,
            error: (createErr as Error).message,
          });
        }

        const orderItemIds = (
          await prisma.orderItem.findMany({ where: { orderId }, select: { id: true } })
        ).map((i) => i.id);

        const downloads = await prisma.downloadRecord.findMany({
          where: { userId: order.userId, orderItemId: { in: orderItemIds } },
        });

        if (downloads.length > 0) {
          digitalDownloads = await Promise.all(
            downloads.map(async (dl) => {
              const asset = await prisma.digitalAsset.findUnique({ where: { id: dl.assetId } });
              const downloadUrl = asset?.r2Key ? await signR2Key(asset.r2Key) : '';
              return {
                fileName: asset?.fileName || 'Unknown file',
                fileSize: asset?.fileSize || 0,
                downloadUrl,
                maxDownloads: dl.maxDownloads,
                expiresAt: dl.expiresAt,
              };
            })
          );
        }
      } catch (err) {
        logger.error('[Email] Failed to prepare digital downloads for receipt', {
          orderId,
          error: (err as Error).message,
        });
      }
    }

    // Send the general receipt with digital download links embedded
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
      paymentChannel: paymentChannel || 'card',
      paidAt,
      shippingAddress: shippingAddr!,
      digitalDownloads,
    }).then((sent) => {
      if (!sent) {
        return;
      }

      return prisma.payment.update({
        where: { id: paymentRecord.id },
        data: {
          metadata: withReceiptSentAt(paymentRecord.metadata) as Prisma.InputJsonValue,
        },
      }).catch(() => {
        logger.warn('[Email] Failed to persist receiptSentAt metadata', {
          paymentId: paymentRecord.id,
        });
      });
    });
  }
}

/**
 * Handle digital product delivery after payment.
 * Creates download records and sends digital delivery email.
 */
async function handleDigitalDelivery(
  orderId: string,
  userId: string,
  customerEmail: string,
  customerName: string,
  orderNumber: string,
): Promise<boolean> {
  try {
    // Create download records for any digital products (ignore duplicates on retry)
    try {
      await createDownloadRecords(orderId, userId);
      logger.info('[DigitalDelivery] Download records created', { orderId, orderNumber });
    } catch (createErr) {
      // Duplicates from webhook+verify race are expected — continue to query & send email
      logger.warn('[DigitalDelivery] createDownloadRecords error (may be duplicate)', {
        orderId,
        error: (createErr as Error).message,
      });
    }

    // Check if there are any digital items in this order
    const orderItemIds = (
      await prisma.orderItem.findMany({ where: { orderId }, select: { id: true } })
    ).map((i) => i.id);

    const downloads = await prisma.downloadRecord.findMany({
      where: { userId, orderItemId: { in: orderItemIds } },
    });

    logger.info('[DigitalDelivery] Found download records', {
      orderId,
      orderNumber,
      count: downloads.length,
    });

    if (downloads.length > 0) {
      // Get asset info and generate presigned download URLs for the email
      const downloadInfo = await Promise.all(
        downloads.map(async (dl) => {
          const asset = await prisma.digitalAsset.findUnique({ where: { id: dl.assetId } });
          const downloadUrl = asset?.r2Key ? await signR2Key(asset.r2Key) : '';
          return {
            fileName: asset?.fileName || 'Unknown file',
            fileSize: asset?.fileSize || 0,
            downloadId: dl.id,
            downloadUrl,
            maxDownloads: dl.maxDownloads,
            expiresAt: dl.expiresAt,
          };
        })
      );

      const sent = await sendDigitalProductDelivery({
        customerEmail,
        customerName,
        orderNumber,
        downloads: downloadInfo,
      });

      logger.info('[DigitalDelivery] Email send result', {
        orderId,
        orderNumber,
        sent,
        to: customerEmail,
        fileCount: downloadInfo.length,
      });

      return sent;
    } else {
      logger.warn('[DigitalDelivery] No download records found — email not sent', {
        orderId,
        orderNumber,
        userId,
        orderItemIds,
      });

      return false;
    }
  } catch (err) {
    logger.error('[DigitalDelivery] Failed to process digital delivery', {
      orderId,
      orderNumber,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });

    return false;
  }
}

/**
 * Generate a unique payment reference.
 * Format: WS-PAY-<nanoid>
 */
function generateReference(): string {
  const uuid = randomUUID().replace(/-/g, '');
  return `WS-PAY-${uuid.slice(0, 16)}`;
}

/**
 * Initialize a Paystack payment for an order.
 * Order must be CREATED and have no existing payment.
 */
export async function initializePayment(
  userId: string,
  userEmail: string,
  orderId: string
): Promise<InitializePaymentResult> {
  // Find the order and verify ownership
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });

  if (!order) {
    throw createError(404, 'Order not found');
  }

  if (order.userId !== userId) {
    throw createError(403, 'Not authorized to pay for this order');
  }

  if (order.status !== OrderStatus.CREATED) {
    throw createError(400, 'Order is not in a payable state');
  }

  // If there's an existing PENDING payment, return that instead of creating a new one
  if (order.payment && order.payment.status === PaymentStatus.PENDING) {
    // Re-initialize with Paystack to get a fresh authorization URL
    const callbackUrl = `${CLIENT_URL || 'http://localhost:5173'}/checkout/success`;
    const paystackRes = await initializeTransaction(
      userEmail,
      order.total,
      order.payment.reference!,
      { orderId: order.id, orderNumber: order.orderNumber, userId },
      callbackUrl
    );

    return {
      authorizationUrl: paystackRes.data.authorization_url,
      accessCode: paystackRes.data.access_code,
      reference: paystackRes.data.reference,
    };
  }

  // Prevent duplicate completed payments
  if (order.payment && order.payment.status === PaymentStatus.COMPLETED) {
    throw createError(400, 'This order has already been paid for');
  }

  const reference = generateReference();
  const callbackUrl = `${CLIENT_URL || 'http://localhost:5173'}/checkout/success`;

  // Call Paystack to initialize transaction
  const paystackRes = await initializeTransaction(
    userEmail,
    order.total,
    reference,
    { orderId: order.id, orderNumber: order.orderNumber, userId },
    callbackUrl
  );

  // Create Payment record in DB
  await prisma.payment.create({
    data: {
      orderId: order.id,
      userId,
      amount: order.total,
      currency: 'NGN',
      status: PaymentStatus.PENDING,
      provider: 'paystack',
      reference,
    },
  });

  return {
    authorizationUrl: paystackRes.data.authorization_url,
    accessCode: paystackRes.data.access_code,
    reference: paystackRes.data.reference,
  };
}

/**
 * Verify a payment by reference (called when user returns from Paystack).
 */
export async function verifyPayment(
  userId: string,
  reference: string
): Promise<VerifyPaymentResult> {
  // Find the payment record
  const payment = await prisma.payment.findUnique({
    where: { reference },
    include: { order: true },
  });

  if (!payment) {
    throw createError(404, 'Payment not found');
  }

  if (payment.userId !== userId) {
    throw createError(403, 'Not authorized to verify this payment');
  }

  // If already completed, return cached result
  if (payment.status === PaymentStatus.COMPLETED) {
    return {
      status: 'success',
      reference: payment.reference!,
      amount: payment.amount,
      channel: payment.channel || 'unknown',
      paidAt: payment.paidAt?.toISOString() || '',
      order: {
        id: payment.order.id,
        orderNumber: payment.order.orderNumber,
        status: payment.order.status,
      },
    };
  }

  // Verify with Paystack
  const paystackRes = await verifyTransaction(reference);
  const data = paystackRes.data;

  if (data.status === 'success') {
    // Update payment and order status in a transaction
    const [updatedPayment] = await prisma.$transaction([
      prisma.payment.update({
        where: { reference },
        data: {
          status: PaymentStatus.COMPLETED,
          paystackId: String(data.id),
          channel: data.channel,
          paidAt: new Date(data.paid_at),
        },
      }),
      prisma.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PAID,
          paidAt: new Date(data.paid_at),
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: payment.orderId,
          status: OrderStatus.PAID,
          note: `Payment confirmed via Paystack (${data.channel})`,
        },
      }),
    ]);

    // Fallback: send receipt after verify (if webhook did not fire)
    void sendReceiptIfNeeded(
      updatedPayment.id,
      payment.orderId,
      data.paid_at,
      data.channel || 'card',
      data.customer?.email
    );

    return {
      status: 'success',
      reference: updatedPayment.reference!,
      amount: updatedPayment.amount,
      channel: data.channel,
      paidAt: data.paid_at,
      order: {
        id: payment.order.id,
        orderNumber: payment.order.orderNumber,
        status: OrderStatus.PAID,
      },
    };
  }

  // Payment failed or was abandoned
  if (data.status === 'failed' || data.status === 'abandoned') {
    await prisma.payment.update({
      where: { reference },
      data: {
        status: PaymentStatus.FAILED,
        paystackId: String(data.id),
        channel: data.channel || null,
      },
    });
  }

  return {
    status: data.status,
    reference,
    amount: payment.amount,
    channel: data.channel || 'unknown',
    paidAt: '',
    order: {
      id: payment.order.id,
      orderNumber: payment.order.orderNumber,
      status: payment.order.status,
    },
  };
}

/**
 * Handle a Paystack webhook event.
 * Called after HMAC signature verification in the controller.
 */
export async function handleWebhook(
  event: PaystackWebhookEvent
): Promise<void> {
  const { data } = event;
  const reference = data.reference;

  // Find the payment
  const payment = await prisma.payment.findUnique({
    where: { reference },
  });

  if (!payment) {
    // Unknown reference — ignore silently
    return;
  }

  // Already completed — idempotent, skip
  if (payment.status === PaymentStatus.COMPLETED) {
    return;
  }

  if (event.event === 'charge.success' && data.status === 'success') {
    await prisma.$transaction([
      prisma.payment.update({
        where: { reference },
        data: {
          status: PaymentStatus.COMPLETED,
          paystackId: String(data.id),
          channel: data.channel,
          paidAt: new Date(data.paid_at),
        },
      }),
      prisma.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PAID,
          paidAt: new Date(data.paid_at),
        },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: payment.orderId,
          status: OrderStatus.PAID,
          note: `Payment confirmed via Paystack webhook (${data.channel})`,
        },
      }),
    ]);

    // Send order receipt email (non-blocking, deduped)
    void sendReceiptIfNeeded(
      payment.id,
      payment.orderId,
      data.paid_at,
      data.channel || 'card',
      data.customer?.email
    );
  } else if (event.event === 'charge.failed') {
    await prisma.payment.update({
      where: { reference },
      data: {
        status: PaymentStatus.FAILED,
        paystackId: String(data.id),
        channel: data.channel || null,
      },
    });
  }
}
