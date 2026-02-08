import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * validate — Generic Zod validation middleware.
 * Validates req.body against the provided schema.
 * Returns 400 with structured error messages on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors: Record<string, string> = {};
        err.issues.forEach((issue) => {
          const field = issue.path.join('.');
          errors[field] = issue.message;
        });

        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors,
        });
        return;
      }

      next(err);
    }
  };
}

/**
 * validateQuery — Validates req.query against the provided schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req.query);
      // Assign validated values back individually to keep ParsedQs type happy
      Object.assign(req.query, parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const errors: Record<string, string> = {};
        err.issues.forEach((issue) => {
          const field = issue.path.join('.');
          errors[field] = issue.message;
        });

        res.status(400).json({
          success: false,
          message: 'Invalid query parameters',
          errors,
        });
        return;
      }

      next(err);
    }
  };
}
