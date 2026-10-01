import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";
import type { HermesService } from "./service.js";

const hermesModelSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    owned_by: z.string(),
    permission: z.array(z.unknown()).optional(),
    root: z.string().nullable().optional(),
    parent: z.string().nullable().optional(),
});

const modelListResponseSchema = z.object({
    object: z.literal("list"),
    data: z.array(hermesModelSchema),
});

export function createHermesRoutes(service: HermesService): FastifyPluginAsyncZod {
    return async (app) => {
        app.get(
            "/hermes/models",
            {
                schema: {
                    response: {
                        200: modelListResponseSchema,
                    },
                },
            },
            async () => {
                const data = await service.getModels();
                return { object: "list" as const, data };
            },
        );
    };
}
