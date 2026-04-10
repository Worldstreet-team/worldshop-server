import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as vendorService from '../services/vendor.service';

/**
 * POST /api/v1/vendor/register
 * Register the authenticated user as a vendor.
 */
export const register = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(createError(401, 'Authentication required'));
  }

  const profile = await vendorService.registerVendor(req.user.id, req.body);

  res.status(201).json({
    success: true,
    data: profile,
    message: 'Vendor registration successful',
  });
});

/**
 * GET /api/v1/vendor/profile
 * Get vendor profile for the authenticated vendor.
 */
export const getProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(createError(401, 'Authentication required'));
  }

  const profile = await vendorService.getVendorProfile(req.user.id);

  res.status(200).json({
    success: true,
    data: profile,
  });
});

/**
 * PATCH /api/v1/vendor/profile
 * Update vendor store name and/or description.
 */
export const updateProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(createError(401, 'Authentication required'));
  }

  const profile = await vendorService.updateVendorProfile(req.user.id, req.body);

  res.status(200).json({
    success: true,
    data: profile,
    message: 'Vendor profile updated successfully',
  });
});
