import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";
import { scopes } from "../../common/scopes.js";
import { auditSourceFrom, getAuthenticatedUser } from "../../plugins/auth.js";
import { apiKeySummarySchema, createApiKeySchema, createdApiKeySchema } from "./dto.js";
import type { ApiKeysService } from "./service.js";

const revokeParamsSchema = z.object({ id: z.string() });

export function createApikeysRoutes(service: ApiKeysService): FastifyPluginAsyncZod {
    return async (app) => {
        app.post(
            "/apikeys",
            {
                schema: {
                    body: createApiKeySchema,
                    response: { 201: createdApiKeySchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.apikeysWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                const result = await service.create(
                    auth.userId,
                    request.body.name,
                    request.body.scopes,
                    auditSourceFrom(request),
                );
                return reply.status(201).send(result);
            },
        );

        app.get(
            "/apikeys",
            {
                schema: {
                    response: { 200: z.array(apiKeySummarySchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.apikeysRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.list(auth.userId);
            },
        );

        app.post(
            "/apikeys/:id/revoke",
            {
                schema: {
                    params: revokeParamsSchema,
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.apikeysWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.revoke(auth.userId, request.params.id, auditSourceFrom(request));
                return reply.status(204).send();
            },
        );
    };
}
