import fp from "fastify-plugin";
import { AppError } from "../common/errors/app-error.js";
import { errorCodes } from "../common/errors/codes.js";
import { toErrorResponse, toHttpStatus } from "../common/errors/http.js";

export const errorHandlerPlugin = fp(async (app) => {
    app.setErrorHandler((error, request, reply) => {
        const statusCode = toHttpStatus(error);
        if (statusCode >= 500) {
            request.log.error({ err: error }, "request failed");
        }
        return reply.status(statusCode).send(toErrorResponse(error, request.id));
    });

    app.setNotFoundHandler((request, reply) => {
        const error = new AppError(
            errorCodes.NOT_FOUND,
            `Route ${request.method} ${request.url} not found`,
        );
        return reply.status(404).send(toErrorResponse(error, request.id));
    });
});
