/**
 * R2 Signed URL Utility
 *
 * Signs R2 object keys with presigned URLs for secure access.
 * - Only signs keys that look like R2 keys (no protocol prefix).
 * - Relative paths (starting with /) are left unchanged (local static files).
 * - Handles both bare R2 keys ("categories/abc.jpg") and full R2 https:// URLs
 *   (extracts path and signs it either way).
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client, R2_BUCKET } from '../configs/r2Config';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604 800 — R2/S3 SigV4 maximum

/**
 * Extract an R2 key from either a bare key or a full https:// R2 URL.
 * Returns null for relative paths (starting with /) or unparseable values.
 */
function resolveR2Key(value: string): string | null {
  if (!value) return null;
  // Relative static path — not an R2 asset
  if (value.startsWith('/')) return null;
  // Full URL — extract the path component as the key
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const key = new URL(value).pathname.replace(/^\//, '');
      return key || null;
    } catch {
      return null;
    }
  }
  // Already a bare R2 key (e.g. "products/abc.jpg")
  return value;
}

/**
 * Sign a single R2 key (or full R2 URL) and return a presigned URL.
 * Accepts bare keys like "categories/abc.jpg" or full https:// R2 URLs.
 * Returns the original string unchanged only for relative paths ("/...").
 */
export async function signR2Key(
  key: string,
  expiresIn: number = SEVEN_DAYS_SECONDS,
): Promise<string> {
  const r2Key = resolveR2Key(key);
  if (!r2Key) return key;

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Sign all image URLs in a product's images JSON array.
 * Each image object has a `url` field that may be an R2 key.
 */
export async function signProductImages(
  images: unknown,
): Promise<Array<Record<string, unknown>>> {
  let parsed: Array<Record<string, unknown>> = [];

  try {
    parsed = Array.isArray(images)
      ? (images as Array<Record<string, unknown>>)
      : JSON.parse(images as string);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return Promise.all(
    parsed.map(async (img) => {
      // Always sign from cloudflareId (the R2 key). If absent, leave the image unchanged.
      if (typeof img.cloudflareId === 'string' && img.cloudflareId) {
        return { ...img, url: await signR2Key(img.cloudflareId) };
      }
      return img;
    }),
  );
}

/**
 * Sign images on a single product object (mutates and returns).
 */
export async function signProductRecord<T extends { images?: unknown }>(
  product: T,
): Promise<T> {
  if (product.images) {
    (product as Record<string, unknown>).images = await signProductImages(
      product.images,
    );
  }
  return product;
}

/**
 * Sign images on an array of product objects.
 */
export async function signProductRecords<T extends { images?: unknown }>(
  products: T[],
): Promise<T[]> {
  return Promise.all(products.map((p) => signProductRecord(p)));
}

/**
 * Sign the `image` field on a single category object.
 * Category images are stored as plain R2 keys (e.g. "categories/abc.jpg").
 */
export async function signCategoryRecord<T extends { image?: string | null }>(
  category: T,
): Promise<T> {
  if (category.image) {
    return { ...category, image: await signR2Key(category.image) };
  }
  return category;
}

/**
 * Sign the `image` field on an array of category objects.
 */
export async function signCategoryRecords<T extends { image?: string | null }>(
  categories: T[],
): Promise<T[]> {
  return Promise.all(categories.map((c) => signCategoryRecord(c)));
}
