import { Response, NextFunction } from 'express';
import type { Request } from 'express';
import catchAsync from '../utils/catchAsync';
import * as uploadService from '../services/upload.service';

/**
 * POST /api/v1/admin/upload/images
 * Upload one or more images to Cloudflare R2.
 * Returns array of { url, key, originalName, size, mimeType }.
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
