import { Router } from 'express';
import * as addressController from '../controllers/address.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// All address routes require authentication
router.use(requireAuth);

// List all addresses
router.get('/', addressController.getAddresses);

// Get single address
router.get('/:id', addressController.getAddress);

// Create new address
router.post('/', addressController.createAddress);

// Update address
router.put('/:id', addressController.updateAddress);

// Delete address
router.delete('/:id', addressController.deleteAddress);

// Set address as default
router.patch('/:id/default', addressController.setDefault);

export default router;
