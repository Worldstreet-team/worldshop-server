import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as downloadService from '../services/download.service';

/**
 * GET /api/v1/downloads
 * Get all download records for the authenticated user.
 */
export const getMyDownloads = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const downloads = await downloadService.getUserDownloads(userId);

    res.status(200).json({
      success: true,
      data: downloads,
    });
  }
);

/**
 * GET /api/v1/downloads/order/:orderId
 * Get download records for a specific order.
 */
export const getOrderDownloads = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const orderId = req.params.orderId as string;
    const downloads = await downloadService.getOrderDownloads(orderId, userId);

    res.status(200).json({
      success: true,
      data: downloads,
    });
  }
);

/**
 * POST /api/v1/downloads/:id/generate
 * Generate a signed download URL. Increments download count.
 * Returns { url, fileName, remainingDownloads }.
 */
export const generateDownloadUrl = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const downloadId = req.params.id as string;
    const result = await downloadService.generateDownloadUrl(downloadId, userId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);
