import { Request, Response, NextFunction } from 'express';
import catchAsync from './catchAsync';
import prisma from '../configs/prismaConfig';

// Format uptime in readable format
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0) parts.push(`${secs}s`);

  return parts.length > 0 ? parts.join(' ') : '0s';
};

// Simple ping function
export const pingServer = async (
  url: string,
): Promise<'online' | 'offline'> => {
  try {
    const response = await fetch(url);
    return response.ok ? 'online' : 'offline';
  } catch (error) {
    return 'offline';
  }
};

/**
 * Ping the database Prisma actually talks to. This used to read
 * `mongoose.connection.readyState`, but nothing in this server connects
 * mongoose — so it reported "disconnected" even while every query succeeded,
 * which made the field useless as a signal.
 */
const checkDatabase = async (): Promise<'connected' | 'disconnected'> => {
  try {
    await prisma.$runCommandRaw({ ping: 1 });
    return 'connected';
  } catch {
    return 'disconnected';
  }
};

// Simple health check middleware
export const healthCheck = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const dbStatus = await checkDatabase();

    res.status(200).json({
      status: 'success',
      message: 'WorldStore API is healthy',
      api: {
        name: 'WorldStore API',
        version: 'v1',
      },
      timestamp: new Date().toISOString(),
      uptime: formatUptime(Math.floor(process.uptime())),
      database: dbStatus,
      server: 'online',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total:
          Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      },
      environment: process.env.NODE_ENV || 'development',
    });
  },
);
