import { PrismaClient } from '../../generated/prisma';
import { dbLog } from './loggerConfig';

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Database connection function with retry logic
export const connectDatabase = async (): Promise<void> => {
  const maxRetries = 5;
  const retryDelay = 2000; // 2 seconds between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    dbLog.warn(
      `Attempting to connect to the database (Attempt ${attempt}/${maxRetries})...`,
    );
    try {
      await prisma.$connect();
      dbLog.info('Database connected successfully');
      return; // Success - exit the function
    } catch (error) {
      dbLog.error(
        `Database connection attempt ${attempt}/${maxRetries} failed: ${error}`,
      );

      if (attempt === maxRetries) {
        // Last attempt failed - exit the process
        dbLog.error('All database connection attempts failed. Exiting...');
        process.exit(1);
      }

      // Wait before retrying (except on last attempt)
      dbLog.info(
        `Retrying database connection in ${retryDelay / 1000} seconds...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
};

// Graceful shutdown function
export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    dbLog.info('Database disconnected successfully');
  } catch (error) {
    dbLog.error(`Error disconnecting from database: ${error}`);
  }
};

export default prisma;
