import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as adminBillingService from '../services/admin.billing.service';
import {
  adminPlanCreateSchema,
  adminPlanUpdateSchema,
  adminRevenueQuerySchema,
} from '../validators/admin.billing.validator';

export const listPlans = catchAsync(async (_req: Request, res: Response, _next: NextFunction) => {
  const plans = await adminBillingService.listPlans();
  res.status(200).json({ success: true, data: plans });
});

export const createPlan = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = adminPlanCreateSchema.parse(req.body);
  const plan = await adminBillingService.createPlan(req.user!.id, input);
  res.status(201).json({ success: true, data: plan, message: 'Plan created.' });
});

export const updatePlan = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const input = adminPlanUpdateSchema.parse(req.body);
  const plan = await adminBillingService.updatePlan(req.user!.id, req.params.id as string, input);
  res.status(200).json({
    success: true,
    data: plan,
    message: 'Plan updated. A new price applies to each subscriber from their next renewal.',
  });
});

export const revenue = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
  const query = adminRevenueQuerySchema.parse(req.query);
  const data = await adminBillingService.getRevenue(query);
  res.status(200).json({ success: true, data });
});
