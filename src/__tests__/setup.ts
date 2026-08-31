import { config } from 'dotenv';
import { resolve } from 'path';
import dns from 'node:dns';

// Load test environment before anything else
config({ path: resolve(__dirname, '../../.env.test'), override: true });

// The mall paywall is temporarily off in production while the feature is
// tested (see configs/featureFlags). The tests assert the real product rule —
// an unpaid mall is hidden — so they pin the flag on rather than tracking
// whatever the current default happens to be. Set before any module reads it.
process.env.MALL_PAYWALL = 'on';

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
