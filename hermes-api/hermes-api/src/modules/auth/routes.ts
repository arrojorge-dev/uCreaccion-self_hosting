import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import type { FastifyRequest } from "fastify";
import { getAuthenticatedUser } from "../../plugins/auth.js";
import {
    authResultSchema,
    loginSchema,
    logoutSchema,
    refreshSchema,
    registerSchema,
    tokenPairSchema,
} from "./dto.js";
import type { AuthService } from "./service.js";
import type { AuthContext } from "./types.js";

function contextOf(request: FastifyRequest): AuthContext {
    return {
        ip: request.ip ?? null,
        userAgent:
            typeof request.headers["user-agent"] === "string"
                ? request.headers["user-agent"]
                : null,
    };
}

export function createAuthRoutes(service: AuthService): FastifyPluginAsyncZod {
    return async (app) => {
        app.post(
            "/auth/register",
            {
                schema: {
                    body: registerSchema,
                    response: { 201: authResultSchema },
                },
                config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
            },
            async (request, reply) => {
                const result = await service.register(request.body, contextOf(request));
                return reply.status(201).send(result);
            },
        );

        app.post(
            "/auth/login",
            {
                schema: {
                    body: loginSchema,
                    response: { 200: authResultSchema },
                },
                config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
            },
            async (request) => service.login(request.body, contextOf(request)),
        );

        app.post(
            "/auth/refresh",
            {
                schema: {
                    body: refreshSchema,
                    response: { 200: tokenPairSchema },
                },
                config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
            },
            async (request) => service.refresh(request.body.refreshToken, contextOf(request)),
        );

        app.post(
            "/auth/logout",
            {
                schema: {
                    body: logoutSchema,
                },
                preHandler: app.requireAuth,
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.logout(auth.userId, request.body.refreshToken);
                return reply.status(204).send();
            },
        );

        app.post(
            "/auth/logout-all",
            {
                preHandler: app.requireAuth,
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.logoutAll(auth.userId);
                return reply.status(204).send();
            },
        );
    };
}
