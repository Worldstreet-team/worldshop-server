import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';
import * as profileService from '../services/profile.service';

/**
 * GET /api/v1/profile
 * Returns the authenticated user's profile. Creates one if it doesn't exist.
 */
export const getProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user || !user.id) {
    return next(createError(401, 'Authentication required'));
  }

  const profile = await profileService.getOrCreateProfile(user);

  res.status(200).json({
    success: true,
    data: profile,
  });
});

/**
 * PATCH /api/v1/profile
 * Updates the authenticated user's profile fields.
 */
export const updateProfile = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user;

  if (!user || !user.id) {
    return next(createError(401, 'Authentication required'));
  }

  // Ensure profile exists before updating
  await profileService.getOrCreateProfile(user);

  const profile = await profileService.updateProfile(user.id, req.body);

  if (!profile) {
    return next(createError(404, 'Profile not found'));
  }

  res.status(200).json({
    success: true,
    data: profile,
    message: 'Profile updated successfully',
  });
});
