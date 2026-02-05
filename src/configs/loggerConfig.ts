import { createLogger, format, level, transports } from 'winston';
import path from 'path';
import fs from 'fs';
import 'winston-daily-rotate-file';
import { NODE_ENV } from './envConfig';

const logDir = path.join(__dirname, '../../', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, label, printf, colorize } = format;

const logLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
  },
};

function logger(labelName: string) {
  return createLogger({
    levels: logLevels.levels,
    format: combine(
      label({ label: labelName }), // Helps identify where you're logging from
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Timestamp format
      printf(({ timestamp, level, message, label }) => {
        return `[${level}] : ${timestamp} [${label}] : ${message}`;
      }),
    ),
    transports: [
      new transports.Console({
        level: 'info',
        format: format.combine(colorize({ all: true }), format.simple()), // colorize the console output, and show simple format
      }),

      new transports.DailyRotateFile({
        level: 'error',
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
        zippedArchive: true, // Compress old log files
        maxSize: '20m', // maximum size of 20MB
        maxFiles: '14d', // keep log files for a total of 14 days
        format: format.combine(
          format.json(),
          format.timestamp(),
          format.prettyPrint(),
        ),
      }), // Log all error files to logs/error.log

      new transports.DailyRotateFile({
        level: 'info',
        filename: 'logs/combined-%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
        zippedArchive: true, // Compress old log files
        maxSize: '20m', // maximum size of 20MB
        maxFiles: '14d', // keep log files for a total of 14 days
        format: format.combine(
          format.json(),
          format.timestamp(),
          format.prettyPrint(),
        ),
      }), // Log all information files to logs/combined.log
    ],
  });
}

const globalLog = logger('Global');
const dbLog = logger('Database');
const authLog = logger('Auth');

// Catch unhandled promise rejections
process.on('unhandledRejection', (error: Error) => {
  globalLog.error(`Unhandled Rejection : ${error.message || error}`);

  // Shutting down the application is optional
  process.exit(1);
});

// Catch uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  globalLog.error(`Uncaught Exceptions : ${error.message || error}`);

  // Shutting down the applicaiton is ooptional
  process.exit(1);
});

// Catch warnings
process.on('warning', (warning) => {
  globalLog.warn(`Warning : ${warning.message || warning}`);
});

export { globalLog, dbLog, authLog };
