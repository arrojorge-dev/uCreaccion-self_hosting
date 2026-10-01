import rateLimit from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { connectRedis, hasRedis } from "../lib/redis.js";

function userAwareKeyGenerator(request: FastifyRequest): string {
    const auth = request.auth;
    if (auth?.type === "user") {
        return `user:${auth.userId}`;
    }
    if (auth?.type === "apiKey") {
        return `apikey:${auth.apiKeyId}`;
    }
    return request.ip;
}

export const registerRateLimit = fp(async (app) => {
    if (!hasRedis()) {
        await app.register(rateLimit, { global: false, keyGenerator: userAwareKeyGenerator });
        return;
    }
    const connected = await connectRedis();
    if (connected) {
        app.log.info("rate-limit store: redis");
        await app.register(rateLimit, {
            global: false,
            redis: connected,
            nameSpace: "fastify-rate-limit-",
            skipOnError: true,
            keyGenerator: userAwareKeyGenerator,
        });
    } else {
        app.log.warn("redis unavailable; rate-limit using in-memory store");
        await app.register(rateLimit, { global: false, keyGenerator: userAwareKeyGenerator });
    }
});
