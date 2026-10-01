import "dotenv/config";
import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const envSchema = z.object({
    NODE_ENV: nodeEnvSchema.default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    LOG_LEVEL: logLevelSchema.default("info"),
    API_BASE_PATH: z.string().regex(/^\//, "must start with /").default("/api/v1"),
    PRETTY_LOGS: z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.union([z.literal(""), z.string().url()]).optional(),

    HERMES_URL: z.string().url().default("http://hermes:8642"),
    HERMES_API_KEY: z.string().min(1, "HERMES_API_KEY is required"),
    HERMES_TIMEOUT_MS: z.coerce.number().int().positive().default(5400000),
    HERMES_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
    HERMES_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
    HERMES_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(10_000),

    JWT_ACCESS_SECRET: z
        .string()
        .min(32, "JWT_ACCESS_SECRET must be at least 32 characters")
        .default("local-jwt-access-secret-not-used-by-local-mode"),
    JWT_REFRESH_SECRET: z
        .string()
        .min(32, "JWT_REFRESH_SECRET must be at least 32 characters")
        .default("local-jwt-refresh-secret-not-used-by-local-mode"),
    JWT_ACCESS_TTL: z.string().default("15m"),
    JWT_REFRESH_TTL: z.string().default("30d"),
    JWT_ISSUER: z.string().default("hermes-api"),

    DOCS_SECRET: z.string().default(""),

    CORS_ORIGINS: z
        .string()
        .default("https://tauri.localhost")
        .transform((value) =>
            value
                .split(",")
                .map((origin) => origin.trim())
                .filter((origin) => origin.length > 0),
        ),

    LOCAL_USER_NICKNAME: z.string().min(1).default("john"),
    LOCAL_USER_PASSWORD: z.string().min(8).default("44349989"),

    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().positive().default(200),

    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    WEBHOOK_RETRY_BASE_MS: z.coerce.number().int().positive().default(200),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    QUOTA_FREE_REQUESTS: z.coerce
        .number()
        .int()
        .min(1)
        .max(1_000_000_000_000)
        .default(1_000_000_000),
    QUOTA_FREE_TOKENS: z.coerce.number().int().min(1).max(1_000_000_000_000).default(500_000),
    QUOTA_PRO_REQUESTS: z.coerce.number().int().min(1).max(1_000_000_000_000).default(5_000),
    QUOTA_PRO_TOKENS: z.coerce.number().int().min(1).max(1_000_000_000_000).default(5_000_000),

    PREFERRED_MODEL: z.string().min(1).default("hermes-agent"),

    // Datos de conexión hermes↔ollama por task. OLLAMA_BASE_URL es obligatoria
    // (el arranque falla sin ella: "NO DATA TO CONNECT FROM HERMES"); la usa
    // hermes-api como fallback en el payload de cada task si el front no manda
    // `base_url`. OLLAMA_API_KEY es opcional (vacía permitida).
    OLLAMA_BASE_URL: z
        .string("NO DATA TO CONNECT FROM HERMES")
        .url("NO DATA TO CONNECT FROM HERMES"),
    OLLAMA_API_KEY: z.string().optional().default(""),

    MAX_INPUT_TOKENS: z.coerce.number().int().min(0).default(1_500_000),

    OUTPUT_FILE_DIR: z.string().min(1).default("/hermes-outputs"),
    TASK_OUTPUT_FILE_MAX_BYTES: z.coerce
        .number()
        .int()
        .min(1)
        .max(500_000_000)
        .default(20 * 1024 * 1024),

    // APNs (push iOS). Con KEY_P8/KEY_ID/TEAM_ID vacíos el push queda desactivado (Noop).
    APNS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    APNS_KEY_P8: z
        .string()
        .default("")
        .transform((value) => value.replace(/\\n/g, "\n")),
    APNS_KEY_ID: z.string().default(""),
    APNS_TEAM_ID: z.string().default(""),
    APNS_TOPIC: z.string().default("dev.ucreaccion.app"),
});

type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
    constructor(issues: z.ZodIssue[]) {
        const lines = issues.map(
            (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        );
        super(`Invalid environment configuration:\n${lines.join("\n")}`);
        this.name = "ConfigError";
    }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
    const parsed = envSchema.safeParse(source);
    if (!parsed.success) {
        throw new ConfigError(parsed.error.issues);
    }
    return parsed.data;
}

export const env = loadEnv();
