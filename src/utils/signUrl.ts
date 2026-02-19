/**
 * R2 Signed URL Utility
 *
 * Signs R2 object keys with presigned URLs for secure access.
 * - Only signs keys that look like R2 keys (no protocol prefix).
 * - Relative paths (starting with /) are left unchanged (local static files).
 * - Already-signed or full http(s) URLs are left unchanged.
 * - All image expiry: 1 year (re-signed on every fetch).
 */
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client, R2_BUCKET } from '../configs/r2Config';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60; // 31 536 000

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
  expiresIn: number = ONE_YEAR_SECONDS,
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
      // Prefer cloudflareId (the R2 key) over url (which may already be a full public URL)
      const keyToSign =
        typeof img.cloudflareId === 'string' && isR2Key(img.cloudflareId)
          ? img.cloudflareId
          : typeof img.url === 'string' && isR2Key(img.url)
            ? img.url
            : null;

      if (keyToSign) {
        return { ...img, url: await signR2Key(keyToSign, ONE_YEAR_SECONDS) };
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
