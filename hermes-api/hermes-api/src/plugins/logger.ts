import type { FastifyServerOptions } from "fastify";
import { env } from "../config/env.js";

export const CENSORED = "[REDACTED]";

const secretKeys = new Set([
    "password",
    "passwordHash",
    "token",
    "accessToken",
    "refreshToken",
    "refreshTokenHash",
    "apiKey",
    "apiKeyHash",
    "secret",
    "authorization",
    "x-api-key",
    "cookie",
]);

const SERIALIZED_KEYS = new Set(["req", "res", "err"]);

function sanitizeCopy(value: unknown, depth: number): unknown {
    if (depth > 6 || value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const copy = value.map((item) => {
            const sanitized = sanitizeCopy(item, depth + 1);
            if (sanitized !== item) {
                changed = true;
            }
            return sanitized;
        });
        return changed ? copy : value;
    }
    const record = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    let changed = false;
    for (const key of Object.keys(record)) {
        if (secretKeys.has(key)) {
            copy[key] = CENSORED;
            changed = true;
        } else {
            const sanitized = sanitizeCopy(record[key], depth + 1);
            copy[key] = sanitized;
            if (sanitized !== record[key]) {
                changed = true;
            }
        }
    }
    return changed ? copy : value;
}

export function logFormatter(obj: Record<string, unknown>): Record<string, unknown> {
    for (const key of Object.keys(obj)) {
        if (SERIALIZED_KEYS.has(key)) {
            continue;
        }
        if (secretKeys.has(key)) {
            obj[key] = CENSORED;
        } else {
            const sanitized = sanitizeCopy(obj[key], 0);
            if (sanitized !== obj[key]) {
                obj[key] = sanitized;
            }
        }
    }
    return obj;
}

export function loggerOptions(): FastifyServerOptions["logger"] {
    const options = {
        level: env.LOG_LEVEL,
        base: { service: "hermes-api" },
        formatters: {
            log: logFormatter,
        },
    };
    if (env.PRETTY_LOGS) {
        return {
            ...options,
            transport: {
                target: "pino-pretty",
                options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
            },
        };
    }
    return options;
}
