import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import type { HealthCheck } from "../../common/health.js";
import { env } from "../../config/env.js";
import { HermesClient } from "./client.js";
import { createHermesRoutes } from "./routes.js";
import { HermesService } from "./service.js";

export { HermesClient } from "./client.js";
export { toAppError } from "./errors.js";
export { createHermesRoutes } from "./routes.js";
export { HermesService } from "./service.js";
export { extractResponseText } from "./text.js";
export * from "./types.js";

export function createHermesClient(): HermesClient {
    return new HermesClient({
        baseUrl: env.HERMES_URL,
        apiKey: env.HERMES_API_KEY,
        timeoutMs: env.HERMES_TIMEOUT_MS,
        // Sin reintento automático a nivel HTTP: un fallo/timeout corta la ejecución
        // y la tarea queda FAILED. `HERMES_RETRIES` queda como env legacy sin efecto.
        retries: 0,
        circuitBreaker: {
            failureThreshold: env.HERMES_CIRCUIT_FAILURE_THRESHOLD,
            cooldownMs: env.HERMES_CIRCUIT_COOLDOWN_MS,
        },
    });
}

export function hermesHealthCheck(client: HermesClient): HealthCheck {
    return {
        name: "hermes",
        check: async () => {
            const service = new HermesService(client);
            await service.ping();
        },
    };
}

export function createHermesModule(options: { client: HermesClient }): FastifyPluginAsyncZod {
    return async (app) => {
        app.addHook("onClose", async () => {
            await options.client.close();
        });
        app.register(createHermesRoutes(new HermesService(options.client)));
    };
}
