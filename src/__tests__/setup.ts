import { config } from 'dotenv';
import { resolve } from 'path';

// Load test environment before anything else
config({ path: resolve(__dirname, '../../.env.test'), override: true });

import prisma from '../configs/prismaConfig';
import { beforeAll, afterAll } from 'vitest';

// Verify we're not accidentally running against production
beforeAll(async () => {
  const url = process.env.DATABASE_URL || '';
  if (!url.includes('test')) {
    throw new Error(
      'Refusing to run tests: DATABASE_URL does not contain "test". ' +
      'Set DATABASE_URL to a test database in .env.test or environment.'
    );
  }
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
