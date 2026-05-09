import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import * as uploadService from '../services/upload.service';

/**
 * DELETE /api/v1/vendor/upload/images
 * Delete vendor's own product images from R2.
 * Body: { keys: string[] }
 */
export const deleteVendorImages = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const { keys } = req.body as { keys: string[] };

  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).json({ success: false, message: 'Provide an array of image keys to delete.' });
    return;
  }

  // Fetch all products for this vendor and check image ownership manually
  // because images are stored in a Json (BSON) array on MongoDB.
  const products = await prisma.product.findMany({
    where: { vendorId },
    select: { images: true },
  });

  const ownedKeys = new Set<string>();
  for (const product of products) {
    const images = (product.images ?? []) as Array<{ cloudflareId?: string }>;
    for (const img of images) {
      if (img.cloudflareId && keys.includes(img.cloudflareId)) {
        ownedKeys.add(img.cloudflareId);
      }
    }
  }

  const unauthorized = keys.filter((k) => !ownedKeys.has(k));
  if (unauthorized.length > 0) {
    throw createError(403, 'You do not have access to some of these images.');
  }

  await uploadService.deleteMultipleImages(keys);

  res.status(200).json({
    success: true,
    message: `${keys.length} image(s) deleted.`,
  });
});
