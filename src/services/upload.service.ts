import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, R2_BUCKET } from '../configs/r2Config';
import { nanoid } from 'nanoid';
import path from 'path';
import { signR2Key } from '../utils/signUrl';

export interface UploadResult {
  /** The R2 object key (stored in DB) */
  key: string;
  /** A presigned URL for immediate display */
  signedUrl: string;
  originalName: string;
  size: number;
  mimeType: string;
}

/**
 * uploadImage — Uploads a single image buffer to Cloudflare R2.
 * Returns the public URL and key for storage in the database.
 */
export async function uploadImage(
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  folder: string = 'products',
): Promise<UploadResult> {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const key = `${folder}/${nanoid(12)}${ext}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return {
    key,
    signedUrl: await signR2Key(key),
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
  };
}

/**
 * uploadMultipleImages — Uploads multiple image files to R2 concurrently.
 */
export async function uploadMultipleImages(
  files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
  folder: string = 'products',
): Promise<UploadResult[]> {
  return Promise.all(files.map((file) => uploadImage(file, folder)));
}

/**
 * deleteImage — Deletes a single image from R2 by its key.
 */
export async function deleteImage(key: string): Promise<void> {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );
}

/**
 * deleteMultipleImages — Deletes multiple images from R2.
 */
export async function deleteMultipleImages(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteImage(key)));
}

/**
 * extractKeyFromUrl — Extracts the R2 key from a full public URL or returns the key as-is.
 */
export function extractKeyFromUrl(url: string): string | null {
  // Already a plain key (no protocol)
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
    return url;
  }
  // Legacy full URL: strip the public base
  const { R2_PUBLIC_BASE_URL } = require('../configs/r2Config');
  if (url.startsWith(R2_PUBLIC_BASE_URL)) {
    return url.slice(R2_PUBLIC_BASE_URL.length + 1);
  }
  return null;
}
