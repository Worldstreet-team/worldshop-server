import { NextFunction, Request, Response } from 'express';

import prisma from '../configs/prismaConfig';
import catchAsync from '../utils/catchAsync';
import createError from 'http-errors';

export const getAllTasks = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const tasks = await prisma.task.findMany();

    res.status(200).json({
      status: 'success',
      data: tasks,
    });
  },
);

export const createTask = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const newTask = await prisma.task.create({
      data: req.body,
    });

    res.status(201).json({
      status: 'success',
      data: newTask,
    });
  },
);

export const getTask = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {

    const id = req.params.id as string;

    const task = await prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      return next(createError(404, 'Task not found'));
    }

    res.status(200).json({
      status: 'success',
      data: task,
    });
  },
);

export const updateTask = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;

    const updatedTask = await prisma.task.update({
      where: { id },
      data: req.body,
    });

    if (!updatedTask) {
      return next(createError(404, 'Task not found'));
    }

    res.status(200).json({
      status: 'success',
      data: updatedTask,
    });
  },
);

export const deleteTask = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;

    const deletedTask = await prisma.task.delete({
      where: { id },
    });

    if (!deletedTask) {
      return next(createError(404, 'Task not found'));
    }

    res.status(204).send();
  },
);
