import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client, R2_BUCKET } from '../configs/r2Config';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604 800 — R2/S3 SigV4 maximum
const CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days — refresh before the 7-day AWS limit

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const urlCache = new Map<string, CacheEntry>();

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
 * Collapse a client-supplied image value to its stable stored form: a full
 * R2/presigned URL becomes its bare key, while bare keys and `/relative`
 * static paths pass through unchanged. Presigned URLs expire and blow past
 * column-size limits, so only the key should ever be persisted.
 */
export function collapseToR2Key(value: string): string {
  return resolveR2Key(value) ?? value;
}

/**
 * Sign a single R2 key (or full R2 URL) and return a presigned URL.
 * Accepts bare keys like "categories/abc.jpg" or full https:// R2 URLs.
 * Returns the original string unchanged only for relative paths ("/...").
 */
async function signR2KeyUncached(
  r2Key: string,
  expiresIn: number = SEVEN_DAYS_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
  });

  return getSignedUrl(r2Client, command, { expiresIn });
}

export async function signR2Key(
  key: string,
  expiresIn: number = SEVEN_DAYS_SECONDS,
): Promise<string> {
  const r2Key = resolveR2Key(key);
  if (!r2Key) return key;

  const cached = urlCache.get(r2Key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const url = await signR2KeyUncached(r2Key, expiresIn);
  urlCache.set(r2Key, { url, expiresAt: Date.now() + CACHE_TTL_MS });
  return url;
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
      // Always sign from cloudflareId (the R2 key) when present.
      if (typeof img.cloudflareId === 'string' && img.cloudflareId) {
        return { ...img, url: await signR2Key(img.cloudflareId) };
      }

      // Fallback: if url is an R2 presigned URL (or bare key), extract the key
      // and re-sign it. This handles products created with a full presigned URL
      // that has since expired, or bare R2 keys stored without cloudflareId.
      if (typeof img.url === 'string' && img.url) {
        const r2Key = resolveR2Key(img.url);
        if (r2Key) {
          try {
            return { ...img, url: await signR2Key(r2Key) };
          } catch {
            // Signing failed — return the image as-is rather than dropping it
          }
        }
      }

      // Fallback: `key` is what the upload endpoint returned before it also
      // emitted `cloudflareId`/`url`. Records written in that window have the
      // R2 key under this name and nothing else usable, so without this they
      // stay permanently unrenderable.
      if (typeof img.key === 'string' && img.key) {
        try {
          return { ...img, url: await signR2Key(img.key) };
        } catch {
          // Signing failed — return the image as-is rather than dropping it
        }
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

/**
 * Sign store branding (logo/banner). Stored values may be bare R2 keys or
 * full presigned URLs captured at upload time that have since expired —
 * signR2Key handles both, and passes `/relative` static paths through.
 */
export async function signStoreBranding<
  T extends { logo?: string | null; banner?: string | null },
>(store: T): Promise<T> {
  const out = { ...store };
  if (out.logo) out.logo = await signR2Key(out.logo);
  if (out.banner) out.banner = await signR2Key(out.banner);
  return out;
}
