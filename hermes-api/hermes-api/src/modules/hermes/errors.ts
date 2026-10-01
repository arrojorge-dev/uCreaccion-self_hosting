import { AppError } from "../../common/errors/app-error.js";
import { errorCodes } from "../../common/errors/codes.js";
import { CircuitOpenError } from "../../lib/circuit-breaker.js";
import { HttpError, MalformedResponseError, RequestTimeoutError } from "../../lib/http.js";

export function toAppError(error: unknown, context: string): AppError {
    if (error instanceof CircuitOpenError) {
        return new AppError(
            errorCodes.UPSTREAM_UNAVAILABLE,
            `${context}: circuit open, skipping upstream call`,
            {
                statusCode: 502,
                details: { retryAfterMs: error.retryAfterMs },
                retryable: true,
                cause: error,
            },
        );
    }
    if (error instanceof RequestTimeoutError) {
        return new AppError(errorCodes.UPSTREAM_TIMEOUT, `${context}: upstream timed out`, {
            statusCode: 502,
            details: { url: error.url },
            retryable: true,
            cause: error,
        });
    }
    if (error instanceof MalformedResponseError) {
        return new AppError(
            errorCodes.UPSTREAM_ERROR,
            `${context}: upstream returned a malformed response`,
            {
                statusCode: 502,
                details: { url: error.url },
                retryable: false,
                cause: error,
            },
        );
    }
    if (error instanceof HttpError) {
        if (error.status >= 500 || error.status === 429) {
            return new AppError(
                errorCodes.UPSTREAM_UNAVAILABLE,
                `${context}: upstream unavailable`,
                {
                    statusCode: 502,
                    details: { status: error.status, url: error.url },
                    retryable: error.retryable,
                    cause: error,
                },
            );
        }
        return new AppError(
            errorCodes.UPSTREAM_ERROR,
            `${context}: upstream rejected the request`,
            {
                statusCode: 502,
                details: { status: error.status, body: error.bodyText, url: error.url },
                retryable: false,
                cause: error,
            },
        );
    }
    return AppError.internal(`${context}: unexpected upstream error`, error);
}
