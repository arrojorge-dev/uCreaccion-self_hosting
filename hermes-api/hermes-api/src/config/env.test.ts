import { describe, expect, it } from "vitest";
import { ConfigError, loadEnv } from "./env.js";

const validEnv = {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hermes_api",
    HERMES_URL: "http://hermes:8642",
    HERMES_API_KEY: "test-key",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
    OLLAMA_BASE_URL: "http://194.228.55.129:36327/v1",
};

describe("loadEnv", () => {
    it("parses a valid environment", () => {
        const env = loadEnv(validEnv);
        expect(env.NODE_ENV).toBe("test");
        expect(env.PORT).toBe(5000);
        expect(env.PRETTY_LOGS).toBe(false);
        expect(env.API_BASE_PATH).toBe("/api/v1");
    });

    it("throws ConfigError when a required secret is missing", () => {
        const { HERMES_API_KEY: _key, ...rest } = validEnv;
        expect(() => loadEnv(rest)).toThrow(ConfigError);
    });

    it("throws ConfigError on an invalid LOG_LEVEL", () => {
        expect(() => loadEnv({ ...validEnv, LOG_LEVEL: "bogus" })).toThrow(ConfigError);
    });

    it("throws ConfigError on a too-short JWT secret", () => {
        expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: "short" })).toThrow(ConfigError);
    });

    it("coerces PORT and parses PRETTY_LOGS", () => {
        const env = loadEnv({ ...validEnv, PORT: "8080", PRETTY_LOGS: "true" });
        expect(env.PORT).toBe(8080);
        expect(env.PRETTY_LOGS).toBe(true);
    });

    it("parses OLLAMA_BASE_URL and defaults OLLAMA_API_KEY to empty", () => {
        const env = loadEnv(validEnv);
        expect(env.OLLAMA_BASE_URL).toBe("http://194.228.55.129:36327/v1");
        expect(env.OLLAMA_API_KEY).toBe("");
    });

    it("throws ConfigError without OLLAMA_BASE_URL (NO DATA TO CONNECT FROM HERMES)", () => {
        const { OLLAMA_BASE_URL: _url, ...rest } = validEnv;
        expect(() => loadEnv(rest)).toThrow(/NO DATA TO CONNECT FROM HERMES/);
    });

    it("allows an explicit empty OLLAMA_API_KEY", () => {
        const env = loadEnv({ ...validEnv, OLLAMA_API_KEY: "" });
        expect(env.OLLAMA_API_KEY).toBe("");
    });
});
