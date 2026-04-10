import { describe, it, expect, vi } from 'vitest';
import { requireVendor } from '../../middlewares/vendor.middleware';
import type { Request, Response, NextFunction } from 'express';

function createMockReqRes(user: Record<string, unknown> | undefined) {
  const req = { user, method: 'GET' } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('requireVendor middleware', () => {
  it('passes through for an active vendor on GET', () => {
    const { req, res, next } = createMockReqRes({
      id: 'v1', isVendor: true, vendorStatus: 'ACTIVE',
    });

    requireVendor(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through for an active vendor on POST', () => {
    const { req, res, next } = createMockReqRes({
      id: 'v1', isVendor: true, vendorStatus: 'ACTIVE',
    });
    req.method = 'POST';

    requireVendor(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks non-vendor with 403', () => {
    const { req, res, next } = createMockReqRes({
      id: 'u1', isVendor: false, vendorStatus: null,
    });

    requireVendor(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Vendor access') }),
    );
  });

  it('blocks BANNED vendor with 403', () => {
    const { req, res, next } = createMockReqRes({
      id: 'v2', isVendor: true, vendorStatus: 'BANNED',
    });

    requireVendor(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('banned') }),
    );
  });

  it('allows SUSPENDED vendor GET (read-only)', () => {
    const { req, res, next } = createMockReqRes({
      id: 'v3', isVendor: true, vendorStatus: 'SUSPENDED',
    });

    requireVendor(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks SUSPENDED vendor POST (write)', () => {
    const { req, res, next } = createMockReqRes({
      id: 'v3', isVendor: true, vendorStatus: 'SUSPENDED',
    });
    req.method = 'POST';

    requireVendor(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('suspended') }),
    );
  });

  it('returns 401 when no user is attached', () => {
    const { req, res, next } = createMockReqRes(undefined);

    requireVendor(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
