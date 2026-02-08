import { Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import * as profileService from '../services/profile.service';

/**
 * GET /api/v1/profile
 * Returns the authenticated user's profile. Creates one if it doesn't exist.
 */
export const getProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;
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
export const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;

  // Ensure profile exists before updating
  await profileService.getOrCreateProfile(user);

  const profile = await profileService.updateProfile(user.id, req.body);

  res.status(200).json({
    success: true,
    data: profile,
    message: 'Profile updated successfully',
  });
});
