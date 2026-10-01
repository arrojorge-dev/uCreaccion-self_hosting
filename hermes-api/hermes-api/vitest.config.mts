import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        env: {
            NODE_ENV: "test",
            LOG_LEVEL: "silent",
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hermes_api",
            REDIS_URL: "",
            HERMES_URL: "http://hermes:8642",
            HERMES_API_KEY: "test-hermes-api-key",
            JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789abcdef",
            JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef0123456789abcdef",
            JWT_ACCESS_TTL: "15m",
            JWT_REFRESH_TTL: "30d",
            JWT_ISSUER: "hermes-api",
        },
    },
});
