import { Request, Response } from 'express';
import createError from 'http-errors';
import catchAsync from '../utils/catchAsync';
import * as chatService from '../services/chat.service';
import { conversationQuerySchema, messageQuerySchema } from '../validators/chat.validator';

function userId(req: Request): string {
  if (!req.user?.id) throw createError(401, 'Authentication required');
  return req.user.id;
}

/**
 * POST /api/v1/conversations
 * Start (or continue) a thread about a listing. Buyers only — a vendor has
 * nothing to ask someone who has not asked them first.
 */
export const start = catchAsync(async (req: Request, res: Response) => {
  const conversation = await chatService.startConversation(userId(req), req.body);

  res.status(201).json({
    success: true,
    data: conversation,
    message: 'Message sent. The seller will be notified.',
  });
});

/** GET /api/v1/conversations?side=buying|selling */
export const list = catchAsync(async (req: Request, res: Response) => {
  const query = conversationQuerySchema.parse(req.query);
  const { conversations, total, unreadTotal } = await chatService.listConversations(userId(req), query);

  res.status(200).json({
    success: true,
    data: conversations,
    meta: { unreadTotal },
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
});

/** GET /api/v1/conversations/unread — single badge count for the header */
export const unread = catchAsync(async (req: Request, res: Response) => {
  const summary = await chatService.getUnreadSummary(userId(req));
  res.status(200).json({ success: true, data: summary });
});

/** GET /api/v1/conversations/:id */
export const get = catchAsync(async (req: Request, res: Response) => {
  const query = messageQuerySchema.parse(req.query);
  const conversation = await chatService.getConversation(userId(req), String(req.params.id), query);

  res.status(200).json({ success: true, data: conversation });
});

/** POST /api/v1/conversations/:id/messages */
export const send = catchAsync(async (req: Request, res: Response) => {
  const message = await chatService.sendMessage(userId(req), String(req.params.id), req.body.body);
  res.status(201).json({ success: true, data: message });
});

/** POST /api/v1/conversations/:id/read */
export const read = catchAsync(async (req: Request, res: Response) => {
  const result = await chatService.markRead(userId(req), String(req.params.id));
  res.status(200).json({ success: true, data: result });
});

/** POST /api/v1/conversations/:id/archive */
export const archive = catchAsync(async (req: Request, res: Response) => {
  const conversation = await chatService.archiveConversation(userId(req), String(req.params.id));
  res.status(200).json({ success: true, data: conversation, message: 'Conversation archived' });
});
