import "dotenv/config";
import { defineConfig } from "vitest/config";

// Los tests de integración usan una BD dedicada (hermes_api_test) para no interferir con
// el backend en ejecución (worker de tareas/outbox comparten el Postgres de compose).
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/integration/**/*.test.ts"],
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
        env: {
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hermes_api_test",
            REDIS_URL: "",
            HERMES_API_KEY: "test-hermes-api-key",
            JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789abcdef",
            JWT_REFRESH_SECRET: "test-refresh-secret-0123456789abcdef0123456789abcdef",
            JWT_ACCESS_TTL: "15m",
            JWT_REFRESH_TTL: "30d",
            JWT_ISSUER: "hermes-api",
            DOCS_SECRET: "test-docs-secret",
            APNS_ENV: "sandbox",
            OUTPUT_FILE_DIR: "/tmp/hermes-outputs-test",
            CORS_ORIGINS: "tauri://localhost,http://localhost:1420",
            LOCAL_USER_NICKNAME: "john",
            LOCAL_USER_PASSWORD: "44349989",
            MAX_INPUT_TOKENS: "0",
            QUOTA_FREE_REQUESTS: "1000000000",
            QUOTA_FREE_TOKENS: "1000000000000",
            QUOTA_PRO_REQUESTS: "1000000000000",
            QUOTA_PRO_TOKENS: "1000000000000",
        },
    },
});
