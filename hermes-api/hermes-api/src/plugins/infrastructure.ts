import type { FastifyPluginAsync } from "fastify";
import type { HealthCheck } from "../common/health.js";
import { databaseHealthCheck, disconnectDatabase } from "../lib/db.js";
import { closeRedis, hasRedis, redisHealthCheck } from "../lib/redis.js";
import { type HermesClient, hermesHealthCheck } from "../modules/hermes/index.js";

export function createInfrastructurePlugin(options: {
    hermesClient: HermesClient;
}): FastifyPluginAsync {
    return async (app) => {
        app.addHook("onClose", async () => {
            await disconnectDatabase();
            await closeRedis();
        });
        const checks: HealthCheck[] = [
            databaseHealthCheck(),
            hermesHealthCheck(options.hermesClient),
        ];
        if (hasRedis()) {
            checks.push(redisHealthCheck());
        }
        for (const check of checks) {
            app.health.register(check);
        }
    };
}
