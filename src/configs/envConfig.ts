import dotenv from 'dotenv';
dotenv.config();

const { 
  PORT, 
  NODE_ENV, 
  MONGO_URI, 
  SENTRY_DSN,
  DATABASE_URL
} = process.env;

export { 
  PORT, 
  NODE_ENV, 
  MONGO_URI, 
  SENTRY_DSN,
  DATABASE_URL
};
