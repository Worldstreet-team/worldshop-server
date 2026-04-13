import express from 'express';
import {
  getAllTasks,
  createTask,
  getTask,
  updateTask,
  deleteTask,
} from '../controllers/taskController';
import { requireAuth } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/admin.middleware';

const router = express.Router();

// All task routes require authentication + admin role
router.use(requireAuth, requireAdmin);

router.route('/').get(getAllTasks).post(createTask);

router.route('/:id').get(getTask).patch(updateTask).delete(deleteTask);

export default router;
