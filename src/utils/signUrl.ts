/**
 * R2 Signed URL Utility
 *
 * Signs R2 object keys with presigned URLs for secure access.
 * - Only signs keys that look like R2 keys (no protocol prefix).
 * - Relative paths (starting with /) are left unchanged (local static files).
 * - Already-signed or full http(s) URLs are left unchanged.
 * - All images are re-signed on every request — no caching of URLs.
 * - Expiry: 7 days (R2/S3 SigV4 hard maximum). Re-signed fresh on every fetch.
 * - Source key is always cloudflareId — url is never used for signing.
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client, R2_BUCKET } from '../configs/r2Config';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604 800 — R2/S3 SigV4 maximum

/**
 * Check if a string is an R2 key (not a full URL and not a relative path).
 * R2 keys look like: "products/abc123.png" or "digital-products/file.pdf"
 */
function isR2Key(value: string): boolean {
  if (!value) return false;
  // Already a full URL or a relative static path
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/')
  ) {
    return false;
  }
  return true;
}

/**
 * Sign a single R2 key and return a presigned URL.
 * Returns the original string if it's not an R2 key.
 */
export async function signR2Key(
  key: string,
  expiresIn: number = SEVEN_DAYS_SECONDS,
): Promise<string> {
  if (!isR2Key(key)) return key;

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
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
