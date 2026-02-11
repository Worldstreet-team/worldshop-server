/**
 * Digital Asset Service
 *
 * Handles upload and management of digital product files (PDFs, docs, etc.)
 * to Cloudflare R2 under the "digital-products/" folder.
 */
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '../configs/r2Config';
import { nanoid } from 'nanoid';
import path from 'path';
import prisma from '../configs/prismaConfig';
import { signR2Key } from '../utils/signUrl';

const DIGITAL_FOLDER = 'digital-products';

export interface DigitalUploadResult {
  /** R2 object key (stored in DB) */
  key: string;
  /** Original file name */
  fileName: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Upload a single digital file to R2.
 */
export async function uploadDigitalFile(
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
): Promise<DigitalUploadResult> {
  const ext = path.extname(file.originalname).toLowerCase() || '';
  const key = `${DIGITAL_FOLDER}/${nanoid(16)}${ext}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // No public cache — digital products are always private
    }),
  );

  return {
    key,
    fileName: file.originalname,
    mimeType: file.mimetype,
    fileSize: file.size,
  };
}

/**
 * Upload multiple digital files to R2 concurrently.
 */
export async function uploadMultipleDigitalFiles(
  files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
): Promise<DigitalUploadResult[]> {
  return Promise.all(files.map((file) => uploadDigitalFile(file)));
}

/**
 * Delete a digital file from R2 by its key.
 */
export async function deleteDigitalFile(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );
}

/**
 * Create DigitalAsset records for a product.
 */
export async function createDigitalAssets(
  productId: string,
  files: DigitalUploadResult[],
): Promise<void> {
  await prisma.digitalAsset.createMany({
    data: files.map((file, index) => ({
      productId,
      fileName: file.fileName,
      r2Key: file.key,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      sortOrder: index,
    })),
  });
}

/**
 * Get digital assets for a product (admin view — includes signed URLs).
 */
export async function getProductDigitalAssets(productId: string) {
  const assets = await prisma.digitalAsset.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
  });

  return Promise.all(
    assets.map(async (asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      sortOrder: asset.sortOrder,
      signedUrl: await signR2Key(asset.r2Key),
      createdAt: asset.createdAt,
    }))
  );
}

/**
 * Delete a specific digital asset by ID (and remove from R2).
 */
export async function deleteDigitalAsset(assetId: string): Promise<void> {
  const asset = await prisma.digitalAsset.findUnique({ where: { id: assetId } });
  if (!asset) return;

  // Delete from R2
  await deleteDigitalFile(asset.r2Key);

  // Delete DB record
  await prisma.digitalAsset.delete({ where: { id: assetId } });
}

/**
 * Replace all digital assets for a product.
 * Deletes old ones from R2 + DB, then creates new ones.
 */
export async function replaceDigitalAssets(
  productId: string,
  newFiles: DigitalUploadResult[],
): Promise<void> {
  // Get existing assets
  const existing = await prisma.digitalAsset.findMany({
    where: { productId },
  });

  // Delete old files from R2
  await Promise.all(existing.map((a) => deleteDigitalFile(a.r2Key)));

  // Delete old DB records
  await prisma.digitalAsset.deleteMany({ where: { productId } });

  // Create new records
  if (newFiles.length > 0) {
    await createDigitalAssets(productId, newFiles);
  }
}
