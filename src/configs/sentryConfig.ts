import * as Sentry from '@sentry/node';
import { NODE_ENV, SENTRY_DSN } from './envConfig';

Sentry.init({
    dsn: SENTRY_DSN,
    environment: NODE_ENV,
    sendDefaultPii: true
});
