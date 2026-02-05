import { createServer, Server as HttpServer } from 'http';
import app from './app';

import { PORT } from './configs/envConfig';

const DEFAULT_PORT = Number(PORT);

const httpServer: HttpServer = createServer(app);

httpServer.listen(DEFAULT_PORT, () => {
  console.log(`Server listening on 'http://localhost:${DEFAULT_PORT}'`);
});
