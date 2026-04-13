import { NODE_ENV } from '../configs/envConfig';
import { Request, Response, NextFunction } from 'express';
import { globalLog } from '../configs/loggerConfig';

interface CustomError extends Error {
    statusCode: number;
    status: string;
}

const sendDevError = (err: CustomError, res: Response): void => {
    res.status(err.statusCode).send({
        status: err.status,
        message: err.message,
        stack: err.stack,
    });
};

const sendProdError = (err: CustomError, res: Response): void => {
    res.status(err.statusCode).send({
        status: err.status,
        message: err.message,
    });
};

export default (err: CustomError, _req: Request, res: Response, _next: NextFunction) => {
    globalLog.error('Unhandled error:', { message: err.message, stack: err.stack });

    err.statusCode = err.statusCode ?? 500;
    err.message = err.message;
    err.status = err.statusCode >= 400 && err.statusCode < 500 ? 'fail' : 'error';

    NODE_ENV === 'prod' ? sendProdError(err, res) : sendDevError(err, res);
};
