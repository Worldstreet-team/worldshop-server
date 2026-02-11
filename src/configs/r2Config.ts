import { S3Client } from '@aws-sdk/client-s3';

import { R2_BUCKET_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL } from "./envConfig";

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.warn('⚠️  Cloudflare R2 env vars missing — image uploads will fail.');
}

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || '',
    secretAccessKey: R2_SECRET_ACCESS_KEY || '',
  },
});

export const R2_BUCKET = R2_BUCKET_NAME || 'goldstreetshop';
export const R2_PUBLIC_BASE_URL = R2_PUBLIC_URL || `https://pub-${R2_ACCOUNT_ID}.r2.dev`;
