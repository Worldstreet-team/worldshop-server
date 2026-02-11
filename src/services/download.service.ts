/**
 * Download Service
 *
 * Manages download records for digital products.
 * Creates download entitlements after payment confirmation.
 * Tracks download counts and enforces limits.
 */
import prisma from '../configs/prismaConfig';
import createError from 'http-errors';
import { signR2Key } from '../utils/signUrl';

const MAX_DOWNLOADS = 2;
const DOWNLOAD_EXPIRY_DAYS = 7;

/**
 * Create download records for all digital assets in a paid order.
 * Called after payment confirmation.
 */
export async function createDownloadRecords(orderId: string, userId: string): Promise<void> {
  // Get order items with their products and digital assets
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: {
            include: {
              digitalAssets: true,
            },
          },
        },
      },
    },
  });

  if (!order) return;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DOWNLOAD_EXPIRY_DAYS);

  const records: Array<{
    orderItemId: string;
    userId: string;
    assetId: string;
    downloadCount: number;
    maxDownloads: number;
    expiresAt: Date;
  }> = [];

  for (const item of order.items) {
    // Only create download records for digital products
    if (item.product.type !== 'DIGITAL') continue;

    for (const asset of item.product.digitalAssets) {
      records.push({
        orderItemId: item.id,
        userId,
        assetId: asset.id,
        downloadCount: 0,
        maxDownloads: MAX_DOWNLOADS,
        expiresAt,
      });
    }
  }

  if (records.length > 0) {
    // Use createMany with skipDuplicates to avoid errors on retry
    await prisma.downloadRecord.createMany({
      data: records,
    });
  }
}

/**
 * Get all download records for a user (their purchased digital products).
 */
export async function getUserDownloads(userId: string) {
  const records = await prisma.downloadRecord.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  // Enrich with asset info
  const enriched = await Promise.all(
    records.map(async (record) => {
      const asset = await prisma.digitalAsset.findUnique({
        where: { id: record.assetId },
        include: {
          product: { select: { id: true, name: true, slug: true } },
        },
      });

      return {
        id: record.id,
        orderItemId: record.orderItemId,
        assetId: record.assetId,
        fileName: asset?.fileName || 'Unknown file',
        mimeType: asset?.mimeType || 'application/octet-stream',
        fileSize: asset?.fileSize || 0,
        productName: asset?.product?.name || 'Unknown product',
        productSlug: asset?.product?.slug || '',
        downloadCount: record.downloadCount,
        maxDownloads: record.maxDownloads,
        remainingDownloads: record.maxDownloads - record.downloadCount,
        expiresAt: record.expiresAt,
        isExpired: new Date() > record.expiresAt,
        canDownload: record.downloadCount < record.maxDownloads && new Date() <= record.expiresAt,
        createdAt: record.createdAt,
      };
    })
  );

  return enriched;
}

/**
 * Get download records for a specific order.
 */
export async function getOrderDownloads(orderId: string, userId: string) {
  // Get order items
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, items: { select: { id: true } } },
  });

  if (!order) throw createError(404, 'Order not found');
  if (order.userId !== userId) throw createError(403, 'Not authorized');

  const orderItemIds = order.items.map((i) => i.id);

  const records = await prisma.downloadRecord.findMany({
    where: {
      orderItemId: { in: orderItemIds },
      userId,
    },
  });

  // Enrich with asset info
  return Promise.all(
    records.map(async (record) => {
      const asset = await prisma.digitalAsset.findUnique({
        where: { id: record.assetId },
        include: {
          product: { select: { id: true, name: true, slug: true } },
        },
      });

      return {
        id: record.id,
        orderItemId: record.orderItemId,
        assetId: record.assetId,
        fileName: asset?.fileName || 'Unknown file',
        mimeType: asset?.mimeType || 'application/octet-stream',
        fileSize: asset?.fileSize || 0,
        productName: asset?.product?.name || 'Unknown product',
        downloadCount: record.downloadCount,
        maxDownloads: record.maxDownloads,
        remainingDownloads: record.maxDownloads - record.downloadCount,
        expiresAt: record.expiresAt,
        isExpired: new Date() > record.expiresAt,
        canDownload: record.downloadCount < record.maxDownloads && new Date() <= record.expiresAt,
        createdAt: record.createdAt,
      };
    })
  );
}

/**
 * Generate a signed download URL for a digital asset.
 * Increments the download count. Enforces limits.
 */
export async function generateDownloadUrl(
  downloadRecordId: string,
  userId: string
): Promise<{ url: string; fileName: string; remainingDownloads: number }> {
  const record = await prisma.downloadRecord.findUnique({
    where: { id: downloadRecordId },
  });

  if (!record) throw createError(404, 'Download record not found');
  if (record.userId !== userId) throw createError(403, 'Not authorized');

  // Check expiry
  if (new Date() > record.expiresAt) {
    throw createError(410, 'Download link has expired. Please contact support.');
  }

  // Check download limit
  if (record.downloadCount >= record.maxDownloads) {
    throw createError(
      429,
      `Download limit reached (${record.maxDownloads} downloads). Please contact support if you need additional access.`
    );
  }

  // Get the asset
  const asset = await prisma.digitalAsset.findUnique({
    where: { id: record.assetId },
  });

  if (!asset) throw createError(404, 'Digital asset not found');

  // Generate signed URL
  const signedUrl = await signR2Key(asset.r2Key);

  // Increment download count
  await prisma.downloadRecord.update({
    where: { id: downloadRecordId },
    data: { downloadCount: { increment: 1 } },
  });

  return {
    url: signedUrl,
    fileName: asset.fileName,
    remainingDownloads: record.maxDownloads - record.downloadCount - 1,
  };
}
