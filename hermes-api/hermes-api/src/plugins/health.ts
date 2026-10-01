import fp from "fastify-plugin";
import { createHealthRegistry, type HealthRegistry } from "../common/health.js";

declare module "fastify" {
    interface FastifyInstance {
        health: HealthRegistry;
    }
}

export const healthPlugin = fp(async (app) => {
    const registry = createHealthRegistry();
    app.decorate("health", registry);

    app.get("/health/live", { schema: { hide: true } }, async () => {
        return { status: "ok", uptime: process.uptime() };
    });

    app.get("/health/ready", { schema: { hide: true } }, async (_request, reply) => {
        const result = await registry.run();
        reply.status(result.status === "ok" ? 200 : 503);
        return result;
    });
});
