import { createServer, Server as HttpServer } from 'http';
import app from './app';

import { PORT } from './configs/envConfig';
import { globalLog } from './configs/loggerConfig';
import { runRenewalSweep } from './services/subscription.service';

const DEFAULT_PORT = Number(PORT) || 3000;

const httpServer: HttpServer = createServer(app);

httpServer.listen(DEFAULT_PORT, () => {
  console.log(`Server listening on 'http://localhost:${DEFAULT_PORT}'`);
});

/**
 * Subscription renewals. Hourly rather than daily so a vendor who tops up
 * during their grace window recovers within the hour instead of waiting for a
 * nightly run. Charges are idempotent per billing period, so extra passes cost
 * nothing.
 */
const RENEWAL_SWEEP_MS = Number(process.env.RENEWAL_SWEEP_MINUTES || 60) * 60 * 1000;

setInterval(() => {
  runRenewalSweep().catch((err) => {
    globalLog.error('[Subscription] Renewal sweep failed', {
      error: (err as Error).message,
    });
  });
}, RENEWAL_SWEEP_MS);
