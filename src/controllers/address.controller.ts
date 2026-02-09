import { Request, Response, NextFunction } from 'express';
import catchAsync from '../utils/catchAsync';
import * as addressService from '../services/address.service';
import { createAddressSchema, updateAddressSchema } from '../validators/address.validator';

/**
 * GET /api/v1/addresses
 * List all addresses for the authenticated user.
 */
export const getAddresses = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user!.id;
    const addresses = await addressService.getUserAddresses(userId);

    res.status(200).json({
      success: true,
      data: addresses,
    });
  }
);

/**
 * GET /api/v1/addresses/:id
 * Get a single address by ID.
 */
export const getAddress = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user!.id;
    const addressId = req.params.id as string;
    const address = await addressService.getAddressById(addressId, userId);

    res.status(200).json({
      success: true,
      data: address,
    });
  }
);

/**
 * POST /api/v1/addresses
 * Create a new address.
 */
export const createAddress = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user!.id;
    const input = createAddressSchema.parse(req.body);
    const address = await addressService.createAddress(userId, input);

    res.status(201).json({
      success: true,
      data: address,
    });
  }
);

/**
 * PUT /api/v1/addresses/:id
 * Update an existing address.
 */
export const updateAddress = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user!.id;
    const addressId = req.params.id as string;
    const input = updateAddressSchema.parse(req.body);
    const address = await addressService.updateAddress(addressId, userId, input);

    res.status(200).json({
      success: true,
      data: address,
    });
  }
);

/**
 * DELETE /api/v1/addresses/:id
 * Delete an address (cannot delete default).
 */
export const deleteAddress = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user!.id;
    const addressId = req.params.id as string;
    const result = await addressService.deleteAddress(addressId, userId);

    res.status(200).json({
      success: true,
      data: result,
    });
  }
);

/**
 * PATCH /api/v1/addresses/:id/default
 * Set an address as the default.
 */
export const setDefault = catchAsync(
  async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user!.id;
    const addressId = req.params.id as string;
    const address = await addressService.setDefaultAddress(addressId, userId);

    res.status(200).json({
      success: true,
      data: address,
    });
  }
);
