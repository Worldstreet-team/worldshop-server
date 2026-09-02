import { createServer, Server as HttpServer } from 'http';
import app from './app';

import { PORT } from './configs/envConfig';
import { globalLog } from './configs/loggerConfig';
import { runRenewalSweep } from './services/subscription.service';
import { runMallRenewalSweep } from './services/mall.subscription.service';
import { reconcileSubstoreStatuses } from './services/mall.service';

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

/**
 * A store's visibility follows its mall, but only via billing transitions —
 * so a mall whose status changes any other way leaves its stores stranded on
 * the old rule. Reconciling is two idempotent updateManys, cheap enough to
 * ride along with every sweep. Run at boot as well, so a deploy that changes
 * the visibility rule takes effect immediately rather than up to an hour later.
 */
function reconcileSubstores(): Promise<void> {
  return reconcileSubstoreStatuses()
    .then(({ revealed, hidden }) => {
      if (revealed || hidden) {
        globalLog.info('[Mall] Substore statuses reconciled', { revealed, hidden });
      }
    })
    .catch((err) => {
      globalLog.error('[Mall] Substore reconciliation failed', {
        error: (err as Error).message,
      });
    });
}

reconcileSubstores();

setInterval(() => {
  // Malls first: a lapsed mall hides its substores before the store sweep
  // runs. Not correctness-critical (substores have no subscriptions of their
  // own), just tidier ordering. Both sweeps are idempotent per period.
  runMallRenewalSweep()
    .catch((err) => {
      globalLog.error('[MallSubscription] Renewal sweep failed', {
        error: (err as Error).message,
      });
    })
    .finally(() => reconcileSubstores())
    .finally(() => {
      runRenewalSweep().catch((err) => {
        globalLog.error('[Subscription] Renewal sweep failed', {
          error: (err as Error).message,
        });
      });
    });
}, RENEWAL_SWEEP_MS);
