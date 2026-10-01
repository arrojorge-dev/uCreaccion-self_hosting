import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { scopes } from "../../common/scopes.js";
import { getAuthenticatedUser } from "../../plugins/auth.js";
import { publicUserSchema, updateProfileSchema } from "./dto.js";
import type { UsersService } from "./service.js";

export function createUsersRoutes(service: UsersService): FastifyPluginAsyncZod {
    return async (app) => {
        app.get(
            "/users/me",
            {
                schema: {
                    response: { 200: publicUserSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.profileRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.getById(auth.userId);
            },
        );

        app.patch(
            "/users/me",
            {
                schema: {
                    body: updateProfileSchema,
                    response: { 200: publicUserSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.profileWrite)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.updateName(auth.userId, request.body);
            },
        );
    };
}
