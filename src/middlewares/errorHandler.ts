import { NODE_ENV } from '../configs/envConfig';
import { Request, Response, NextFunction } from 'express';

interface CustomError extends Error {
    statusCode: number;
    status: string;
    code?: number;
    keyValue?: { [key: string]: any };
    errors?: { [key: string]: any };
}

const handleDuplicateKeyError = (err: CustomError): CustomError => {
    const field = Object.keys(err.keyValue || {})[0];
    const value = err.keyValue?.[field];
    const message = `Duplicate value for ${field}: ${value}. Please use another value.`;

    return {
        ...err,
        statusCode: 400,
        status: 'fail',
        message,
    };
};

const handleValidationError = (err: CustomError): CustomError => {
    if (err.errors) {
        const errorMessages: string[] = [];

        for (const field in err.errors) {
            const fieldError = err.errors[field];

            // Handle enum validation errors dynamically
            if (fieldError.kind === 'enum') {
                const validValues = fieldError.properties?.enumValues || [];
                const invalidValue = fieldError.value;
                const message = `Invalid value '${invalidValue}' for field '${field}'. Allowed values are: ${validValues.join(', ')}.`;
                errorMessages.push(message);
            }
            // Handle other validation errors
            else if (fieldError.name === 'ValidatorError') {
                errorMessages.push(
                    fieldError.message || `Invalid value for field '${field}'.`,
                );
            }
            // Handle any other validation errors
            else if (fieldError.message) {
                errorMessages.push(fieldError.message);
            }
        }

        // If we have specific error messages, use them
        if (errorMessages.length > 0) {
            const message = errorMessages.join(' ');
            return {
                ...err,
                statusCode: 400,
                status: 'fail',
                message,
            };
        }

        // Fallback for other validation errors
        const errors = Object.values(err.errors).map(
            (val: any) => val.message || 'Validation error',
        );
        const message = `Invalid input data. ${errors.join('. ')}`;
        return {
            ...err,
            statusCode: 400,
            status: 'fail',
            message,
        };
    }

    return err;
};

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

export default (err: CustomError, _req: Request, res: Response, next: NextFunction) => {
    const error = { ...err };

    console.error('Error occured 🤯💥:', error);
    console.log(err);

    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
        err = handleDuplicateKeyError(err);
    }

    // Handle Mongoose validation errors (including enum validation)
    if (err.name === 'ValidationError') {
        err = handleValidationError(err);
    }

    err.statusCode = err.statusCode ?? 500;
    err.message = err.message;
    err.status = err.statusCode >= 400 && err.statusCode < 500 ? 'fail' : 'error';

    NODE_ENV === 'prod' ? sendProdError(err, res) : sendDevError(err, res);

    next();
};
