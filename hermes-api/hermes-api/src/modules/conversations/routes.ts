import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";
import { scopes } from "../../common/scopes.js";
import { getAuthenticatedUser } from "../../plugins/auth.js";
import {
    conversationDetailSchema,
    conversationDtoSchema,
    conversationIdParamsSchema,
    createConversationSchema,
    messageDtoSchema,
} from "./dto.js";
import type { ConversationsService } from "./service.js";

export function createConversationsRoutes(service: ConversationsService): FastifyPluginAsyncZod {
    return async (app) => {
        app.post(
            "/conversations",
            {
                schema: {
                    body: createConversationSchema,
                    response: { 201: conversationDtoSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.conversationsWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                const result = await service.create(auth.userId, request.body);
                return reply.status(201).send(result);
            },
        );

        app.get(
            "/conversations",
            {
                schema: {
                    response: { 200: z.array(conversationDtoSchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.conversationsRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.list(auth.userId);
            },
        );

        app.get(
            "/conversations/:id",
            {
                schema: {
                    params: conversationIdParamsSchema,
                    response: { 200: conversationDetailSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.conversationsRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.getWithMessages(auth.userId, request.params.id);
            },
        );

        app.get(
            "/conversations/:id/messages",
            {
                schema: {
                    params: conversationIdParamsSchema,
                    response: { 200: z.array(messageDtoSchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.conversationsRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.listMessages(auth.userId, request.params.id);
            },
        );

        app.post(
            "/conversations/:id/reset",
            {
                schema: {
                    params: conversationIdParamsSchema,
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.conversationsWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.resetContext(auth.userId, request.params.id);
                return reply.status(204).send();
            },
        );
    };
}
