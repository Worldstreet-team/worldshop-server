import { config } from 'dotenv';
import { resolve } from 'path';
import dns from 'node:dns';

// Load test environment before anything else
config({ path: resolve(__dirname, '../../.env.test'), override: true });

// Atlas SRV lookups fail on some local resolvers (querySrv EBADRESP) — same
// workaround every script in scripts/ uses. Without it the first $connect
// hangs and the whole suite stalls before a single test runs.
dns.setServers(['1.1.1.1', '8.8.8.8']);

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
