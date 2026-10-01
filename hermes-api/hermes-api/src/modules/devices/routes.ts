import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { deviceDtoSchema, deviceTokenParamsSchema, registerDeviceBodySchema } from "./dto.js";
import type { DevicesService } from "./service.js";

export function createDevicesRoutes(service: DevicesService): FastifyPluginAsyncZod {
    return async (app) => {
        app.post(
            "/devices",
            {
                schema: {
                    body: registerDeviceBodySchema,
                    response: { 200: deviceDtoSchema, 201: deviceDtoSchema },
                },
            },
            async (request, reply) => {
                const { device, created } = await service.register(request.body);
                return reply.status(created ? 201 : 200).send(device);
            },
        );

        app.delete(
            "/devices/:token",
            {
                schema: {
                    params: deviceTokenParamsSchema,
                },
            },
            async (request, reply) => {
                await service.unregister(request.params.token);
                return reply.status(204).send();
            },
        );
    };
}
