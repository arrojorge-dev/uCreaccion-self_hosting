import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";
import { scopes } from "../../common/scopes.js";
import { getAuthenticatedUser } from "../../plugins/auth.js";
import { notificationDtoSchema, notificationIdParamsSchema, unreadCountSchema } from "./dto.js";
import type { NotificationsService } from "./service.js";

export function createNotificationsRoutes(service: NotificationsService): FastifyPluginAsyncZod {
    return async (app) => {
        app.get(
            "/notifications",
            {
                schema: {
                    response: { 200: z.array(notificationDtoSchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.notificationsRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.list(auth.userId);
            },
        );

        app.get(
            "/notifications/unread-count",
            {
                schema: {
                    response: { 200: unreadCountSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.notificationsRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                const unread = await service.unreadCount(auth.userId);
                return { unread };
            },
        );

        app.get(
            "/notifications/:id",
            {
                schema: {
                    params: notificationIdParamsSchema,
                    response: { 200: notificationDtoSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.notificationsRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.get(auth.userId, request.params.id);
            },
        );

        app.patch(
            "/notifications/:id/read",
            {
                schema: {
                    params: notificationIdParamsSchema,
                    response: { 200: notificationDtoSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.notificationsWrite)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.markRead(auth.userId, request.params.id);
            },
        );

        app.patch(
            "/notifications/read-all",
            {
                preHandler: [app.requireAuth, app.requireScope(scopes.notificationsWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.markAllRead(auth.userId);
                return reply.status(204).send();
            },
        );
    };
}
