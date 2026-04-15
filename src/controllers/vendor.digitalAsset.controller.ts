import { Response, NextFunction } from 'express';
import type { Request } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import prisma from '../configs/prismaConfig';
import * as digitalAssetService from '../services/digitalAsset.service';

/**
 * Verify the vendor owns the product.
 */
async function verifyProductOwnership(productId: string, vendorId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { vendorId: true },
  });
  if (!product) throw createError(404, 'Product not found');
  if (product.vendorId !== vendorId) throw createError(403, 'You do not have access to this product');
}

/**
 * GET /api/v1/vendor/products/:id/digital-assets
 */
export const getDigitalAssets = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const productId = req.params.id as string;

  await verifyProductOwnership(productId, vendorId);
  const assets = await digitalAssetService.getProductDigitalAssets(productId);

  res.status(200).json({ success: true, data: assets });
});

/**
 * POST /api/v1/vendor/products/:id/digital-assets
 * Body: { files: [{ key, fileName, mimeType, fileSize }] }
 */
export const attachDigitalAssets = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const productId = req.params.id as string;

  await verifyProductOwnership(productId, vendorId);

  const raw = req.body.files ?? req.body.assets ?? req.body;
  const incoming = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && (raw.key || raw.r2Key || raw.fileName) ? [raw] : [];

  if (incoming.length === 0) {
    res.status(400).json({ success: false, message: 'Provide at least one file to attach.' });
    return;
  }

  const filesArray: digitalAssetService.DigitalUploadResult[] = incoming.map((f: any) => {
    const key: string = f.key || f.r2Key || '';
    const fileName: string = f.fileName || key.split('/').pop() || 'unnamed-file';
    return {
      key,
      fileName,
      mimeType: f.mimeType || 'application/octet-stream',
      fileSize: f.fileSize ?? f.size ?? 0,
    };
  });

  await digitalAssetService.createDigitalAssets(productId, filesArray);
  const assets = await digitalAssetService.getProductDigitalAssets(productId);

  res.status(201).json({
    success: true,
    data: assets,
    message: `${filesArray.length} digital asset(s) attached.`,
  });
});

/**
 * DELETE /api/v1/vendor/digital-assets/:assetId
 */
export const deleteDigitalAsset = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const vendorId = req.user!.id;
  const assetId = req.params.assetId as string;

  // Look up the asset → product → verify ownership
  const asset = await prisma.digitalAsset.findUnique({
    where: { id: assetId },
    select: { product: { select: { vendorId: true } } },
  });
  if (!asset) throw createError(404, 'Digital asset not found');
  if (asset.product.vendorId !== vendorId) throw createError(403, 'You do not have access to this asset');

  await digitalAssetService.deleteDigitalAsset(assetId);

  res.status(200).json({ success: true, message: 'Digital asset deleted.' });
});
