import { Request, Response, NextFunction, RequestHandler } from 'express';

export default <T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
};
