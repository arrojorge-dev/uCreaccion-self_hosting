import { hasZodFastifySchemaValidationErrors } from "@fastify/type-provider-zod";
import type { FastifyError } from "fastify";
import { AppError } from "./app-error.js";
import { errorCodes } from "./codes.js";

export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
        requestId: string;
        details?: unknown;
    };
}

function isFastifyError(error: unknown): error is FastifyError {
    return error instanceof Error && "statusCode" in error && typeof error.statusCode === "number";
}

function mapFastifyStatus(statusCode: number): { code: string; message: string } {
    switch (statusCode) {
        case 400:
            return { code: errorCodes.VALIDATION, message: "Request validation failed" };
        case 401:
            return { code: errorCodes.UNAUTHORIZED, message: "Unauthorized" };
        case 403:
            return { code: errorCodes.FORBIDDEN, message: "Forbidden" };
        case 404:
            return { code: errorCodes.NOT_FOUND, message: "Not found" };
        case 413:
            return { code: errorCodes.PAYLOAD_TOO_LARGE, message: "Payload too large" };
        case 429:
            return { code: errorCodes.RATE_LIMITED, message: "Rate limit exceeded" };
        default:
            return { code: errorCodes.INTERNAL, message: "Internal server error" };
    }
}

export function toHttpStatus(error: unknown): number {
    if (error instanceof AppError) {
        return error.statusCode;
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
        return 400;
    }
    if (isFastifyError(error)) {
        return error.statusCode ?? 500;
    }
    return 500;
}

export function toErrorResponse(error: unknown, requestId: string): ApiErrorBody {
    if (error instanceof AppError) {
        return {
            error: {
                code: error.code,
                message: error.message,
                requestId,
                ...(error.details !== undefined ? { details: error.details } : {}),
            },
        };
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
        return {
            error: {
                code: errorCodes.VALIDATION,
                message: "Request validation failed",
                requestId,
                details: error.validation,
            },
        };
    }
    if (isFastifyError(error)) {
        const mapped = mapFastifyStatus(error.statusCode ?? 500);
        return { error: { code: mapped.code, message: mapped.message, requestId } };
    }
    return { error: { code: errorCodes.INTERNAL, message: "Internal server error", requestId } };
}
