import { Redis } from "ioredis";
import type { HealthCheck } from "../common/health.js";
import { env } from "../config/env.js";

let client: Redis | null = null;

export function hasRedis(): boolean {
    return typeof env.REDIS_URL === "string" && env.REDIS_URL.length > 0;
}

function createClient(): Redis {
    return new Redis(env.REDIS_URL as string, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
    });
}

export function getRedisClient(): Redis | null {
    if (!hasRedis()) {
        return null;
    }
    if (!client) {
        client = createClient();
    }
    return client;
}

async function connectAndPing(): Promise<Redis | null> {
    const redis = getRedisClient();
    if (!redis) {
        return null;
    }
    try {
        if (redis.status === "wait" || redis.status === "end") {
            await redis.connect();
        }
        await redis.ping();
        return redis;
    } catch {
        return null;
    }
}

export async function connectRedis(): Promise<Redis | null> {
    return connectAndPing();
}

export function redisHealthCheck(): HealthCheck {
    return {
        name: "redis",
        check: async () => {
            const redis = await connectAndPing();
            if (!redis) {
                throw new Error("REDIS_URL is not configured or redis is unreachable");
            }
        },
    };
}

export async function closeRedis(): Promise<void> {
    if (!client) {
        return;
    }
    const current = client;
    client = null;
    try {
        await current.quit();
    } catch {
        current.disconnect();
    }
}
