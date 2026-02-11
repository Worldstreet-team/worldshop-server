import { Response, NextFunction } from 'express';
import type { Request } from 'express';
import catchAsync from '../utils/catchAsync';
import * as uploadService from '../services/upload.service';
import * as digitalAssetService from '../services/digitalAsset.service';

/**
 * POST /api/v1/admin/upload/images
 * Upload one or more images to Cloudflare R2.
 * Returns array of { key, signedUrl, originalName, size, mimeType }.
 */
export const uploadImages = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const files = (req as any).files as { buffer: Buffer; originalname: string; mimetype: string; size: number }[];

  if (!files || files.length === 0) {
    res.status(400).json({ success: false, message: 'No files provided.' });
    return;
  }

  const folder = (req.query.folder as string) || 'products';
  const results = await uploadService.uploadMultipleImages(files, folder);

  res.status(201).json({
    success: true,
    data: results,
  });
});

/**
 * DELETE /api/v1/admin/upload/images
 * Delete one or more images from Cloudflare R2 by key.
 * Body: { keys: string[] }
 */
export const deleteImages = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const { keys } = req.body as { keys: string[] };

  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).json({ success: false, message: 'Provide an array of image keys to delete.' });
    return;
  }

  await uploadService.deleteMultipleImages(keys);

  res.status(200).json({
    success: true,
    message: `${keys.length} image(s) deleted.`,
  });
});

/**
 * POST /api/v1/admin/upload/digital-files
 * Upload digital product files to Cloudflare R2.
 * Returns array of { key, fileName, mimeType, fileSize }.
 */
export const uploadDigitalFiles = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const files = (req as any).files as { buffer: Buffer; originalname: string; mimetype: string; size: number }[];

  if (!files || files.length === 0) {
    res.status(400).json({ success: false, message: 'No files provided.' });
    return;
  }

  const results = await digitalAssetService.uploadMultipleDigitalFiles(files);

  res.status(201).json({
    success: true,
    data: results,
  });
});

/**
 * POST /api/v1/admin/products/:id/digital-assets
 * Attach uploaded digital files to a product.
 * Body: { files: [{ key, fileName, mimeType, fileSize }] }
 */
export const attachDigitalAssets = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const productId = req.params.id as string;
  const { files } = req.body as { files: digitalAssetService.DigitalUploadResult[] };

  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, message: 'Provide an array of files to attach.' });
    return;
  }

  await digitalAssetService.createDigitalAssets(productId, files);
  const assets = await digitalAssetService.getProductDigitalAssets(productId);

  res.status(201).json({
    success: true,
    data: assets,
    message: `${files.length} digital asset(s) attached.`,
  });
});

/**
 * GET /api/v1/admin/products/:id/digital-assets
 * Get digital assets for a product (with signed URLs).
 */
export const getDigitalAssets = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const productId = req.params.id as string;
  const assets = await digitalAssetService.getProductDigitalAssets(productId);

  res.status(200).json({
    success: true,
    data: assets,
  });
});

/**
 * DELETE /api/v1/admin/digital-assets/:assetId
 * Delete a single digital asset (from R2 + DB).
 */
export const deleteDigitalAsset = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const assetId = req.params.assetId as string;
  await digitalAssetService.deleteDigitalAsset(assetId);

  res.status(200).json({
    success: true,
    message: 'Digital asset deleted.',
  });
});
