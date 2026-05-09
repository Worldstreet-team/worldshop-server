import { createServer, Server as HttpServer } from 'http';
import app from './app';

import { PORT } from './configs/envConfig';
import { globalLog } from './configs/loggerConfig';
import { releaseExpiredCheckoutSessions } from './services/checkout.service';

const DEFAULT_PORT = Number(PORT) || 3000;

const httpServer: HttpServer = createServer(app);

httpServer.listen(DEFAULT_PORT, () => {
  console.log(`Server listening on 'http://localhost:${DEFAULT_PORT}'`);
});

setInterval(() => {
  releaseExpiredCheckoutSessions().catch((err) => {
    globalLog.error('[Checkout] Expired reservation sweep failed', {
      error: (err as Error).message,
    });
  });
}, 15 * 60 * 1000);
