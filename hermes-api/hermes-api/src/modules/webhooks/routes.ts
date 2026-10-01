import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";
import { scopes } from "../../common/scopes.js";
import { auditSourceFrom, getAuthenticatedUser } from "../../plugins/auth.js";
import {
    createdWebhookSchema,
    createWebhookSchema,
    deliveryIdParamsSchema,
    updateWebhookSchema,
    webhookDeliveryDtoSchema,
    webhookDtoSchema,
    webhookIdParamsSchema,
} from "./dto.js";
import type { WebhooksService } from "./service.js";

export function createWebhooksRoutes(service: WebhooksService): FastifyPluginAsyncZod {
    return async (app) => {
        app.post(
            "/webhooks",
            {
                schema: {
                    body: createWebhookSchema,
                    response: { 201: createdWebhookSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                const created = await service.create(
                    auth.userId,
                    request.body,
                    auditSourceFrom(request),
                );
                return reply.status(201).send(created);
            },
        );

        app.get(
            "/webhooks",
            {
                schema: {
                    response: { 200: z.array(webhookDtoSchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.list(auth.userId);
            },
        );

        app.get(
            "/webhooks/:id",
            {
                schema: {
                    params: webhookIdParamsSchema,
                    response: { 200: webhookDtoSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.get(auth.userId, request.params.id);
            },
        );

        app.patch(
            "/webhooks/:id",
            {
                schema: {
                    params: webhookIdParamsSchema,
                    body: updateWebhookSchema,
                    response: { 200: webhookDtoSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksWrite)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.update(
                    auth.userId,
                    request.params.id,
                    request.body,
                    auditSourceFrom(request),
                );
            },
        );

        app.delete(
            "/webhooks/:id",
            {
                schema: {
                    params: webhookIdParamsSchema,
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.delete(auth.userId, request.params.id, auditSourceFrom(request));
                return reply.status(204).send();
            },
        );

        app.get(
            "/webhooks/:id/deliveries",
            {
                schema: {
                    params: webhookIdParamsSchema,
                    response: { 200: z.array(webhookDeliveryDtoSchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.listDeliveries(auth.userId, request.params.id);
            },
        );

        app.post(
            "/webhooks/:id/deliveries/:deliveryId/redeliver",
            {
                schema: {
                    params: deliveryIdParamsSchema,
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.webhooksWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.redeliverDelivery(auth.userId, request.params.deliveryId);
                return reply.status(204).send();
            },
        );
    };
}
