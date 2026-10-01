import { type ErrorCode, errorCodes } from "./codes.js";

export interface AppErrorOptions {
    statusCode?: number;
    details?: unknown;
    retryable?: boolean;
    cause?: unknown;
}

export class AppError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly details: unknown;
    readonly retryable: boolean;

    constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
        super(message, { cause: options.cause });
        this.name = "AppError";
        this.code = code;
        this.statusCode = options.statusCode ?? 500;
        this.details = options.details;
        this.retryable = options.retryable ?? false;
    }

    static badRequest(message = "Bad request", details?: unknown): AppError {
        return new AppError(errorCodes.BAD_REQUEST, message, { statusCode: 400, details });
    }

    static validation(message = "Validation failed", details?: unknown): AppError {
        return new AppError(errorCodes.VALIDATION, message, { statusCode: 400, details });
    }

    static unauthorized(message = "Unauthorized"): AppError {
        return new AppError(errorCodes.UNAUTHORIZED, message, { statusCode: 401 });
    }

    static forbidden(message = "Forbidden"): AppError {
        return new AppError(errorCodes.FORBIDDEN, message, { statusCode: 403 });
    }

    static notFound(message = "Not found"): AppError {
        return new AppError(errorCodes.NOT_FOUND, message, { statusCode: 404 });
    }

    static conflict(message = "Conflict", details?: unknown): AppError {
        return new AppError(errorCodes.CONFLICT, message, { statusCode: 409, details });
    }

    static rateLimited(message = "Rate limit exceeded", details?: unknown): AppError {
        return new AppError(errorCodes.RATE_LIMITED, message, { statusCode: 429, details });
    }

    static internal(message = "Internal server error", cause?: unknown): AppError {
        return new AppError(errorCodes.INTERNAL, message, { statusCode: 500, cause });
    }
}
