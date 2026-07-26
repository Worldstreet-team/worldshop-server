import { Request, Response } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import * as reportService from '../services/report.service';
import {
  reportQuerySchema,
  queueQuerySchema,
  actionReportSchema,
  dismissReportSchema,
} from '../validators/report.validator';

function userId(req: Request): string {
  if (!req.user?.id) throw createError(401, 'Authentication required');
  return req.user.id;
}

/**
 * Mongo object ids are 24 hex chars, and Prisma throws an unhandled validation
 * error on anything else — a 400 is the honest answer to a malformed id.
 */
function reportId(req: Request): string {
  const id = String(req.params.id);
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw createError(400, 'Invalid report id');
  return id;
}

/**
 * POST /api/v1/reports
 * Reporting requires an account: anonymous reports cannot be deduplicated or
 * held to account, and a queue of unattributable claims is noise.
 */
export const create = catchAsync(async (req: Request, res: Response) => {
  const report = await reportService.createReport(userId(req), req.body);

  res.status(201).json({
    success: true,
    data: { id: report.id, status: report.status },
    message: 'Thanks — our team will review this.',
  });
});

/** GET /api/v1/reports/mine */
export const mine = catchAsync(async (req: Request, res: Response) => {
  const query = reportQuerySchema.parse(req.query);
  const { reports, total } = await reportService.listMyReports(userId(req), query);

  res.status(200).json({
    success: true,
    data: reports,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

// ─── Admin ──────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/reports/queue
 * One row per reported thing, ranked by how many people reported it. A flat
 * list of report rows buries the signal — twelve reports about one scam listing
 * look identical to twelve unrelated complaints.
 */
export const queue = catchAsync(async (req: Request, res: Response) => {
  const { targetType } = queueQuerySchema.parse(req.query);
  const entries = await reportService.listQueue({ targetType });

  res.status(200).json({ success: true, data: entries, meta: { openTargets: entries.length } });
});

/** GET /api/v1/admin/reports */
export const list = catchAsync(async (req: Request, res: Response) => {
  const query = reportQuerySchema.parse(req.query);
  const { reports, total } = await reportService.listReports(query);

  res.status(200).json({
    success: true,
    data: reports,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/** GET /api/v1/admin/reports/stats */
export const stats = catchAsync(async (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await reportService.reportStats() });
});

/** GET /api/v1/admin/reports/:id — includes the target and any sibling reports */
export const get = catchAsync(async (req: Request, res: Response) => {
  const detail = await reportService.getReport(reportId(req));
  res.status(200).json({ success: true, data: detail });
});

/** PATCH /api/v1/admin/reports/:id/claim */
export const claim = catchAsync(async (req: Request, res: Response) => {
  const report = await reportService.claimReport(reportId(req), userId(req));
  res.status(200).json({ success: true, data: report, message: 'Report claimed for review' });
});

/**
 * POST /api/v1/admin/reports/:id/dismiss
 * Closes every open report on the same target — resolving one and leaving
 * eleven duplicates means the next admin redoes the investigation.
 */
export const dismiss = catchAsync(async (req: Request, res: Response) => {
  const { note } = dismissReportSchema.parse(req.body);
  const result = await reportService.dismissReport(reportId(req), userId(req), note);

  res.status(200).json({
    success: true,
    data: result,
    message: `Dismissed ${result.dismissed} report(s) on this target.`,
  });
});

/** POST /api/v1/admin/reports/:id/action */
export const action = catchAsync(async (req: Request, res: Response) => {
  const { action: decision, note } = actionReportSchema.parse(req.body);
  const result = await reportService.actionReport(reportId(req), userId(req), decision, note);

  const extra =
    result.listingsHidden != null ? ` ${result.listingsHidden} listing(s) hidden.` : '';

  res.status(200).json({
    success: true,
    data: result,
    message: `${decision.replace(/_/g, ' ').toLowerCase()} applied. ${result.reportsClosed} report(s) closed.${extra}`,
  });
});
