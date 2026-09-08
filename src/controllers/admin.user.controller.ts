import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as adminUserService from '../services/admin.user.service';
import { adminUserListSchema, adminUserRoleSchema } from '../validators/admin.user.validator';

export const listUsers = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const query = adminUserListSchema.parse(req.query);
  const result = await adminUserService.listUsers(query);

  res.status(200).json({ success: true, ...result });
});

export const updateUserRole = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = adminUserRoleSchema.parse(req.body);
  const result = await adminUserService.updateUserRole(req.user!.id, req.params.id as string, input);

  res.status(200).json({
    success: true,
    data: result,
    message: `User role updated to ${input.role}.`,
  });
});

export const resendSetup = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const result = await adminUserService.resendSetupLink(req.user!.id, req.params.id as string);

  res.status(200).json({
    success: true,
    data: result,
    message: 'Setup link sent.',
  });
});
