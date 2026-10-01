import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { signAccessToken } from "../lib/jwt.js";
import { getAuthenticatedUser, parseAuthHeader } from "./auth.js";

describe("parseAuthHeader", () => {
    it("parses a bearer token", () => {
        expect(parseAuthHeader({ authorization: "Bearer abc123" })).toEqual({
            type: "bearer",
            token: "abc123",
        });
    });

    it("parses an api key", () => {
        expect(parseAuthHeader({ "x-api-key": "hk_key" })).toEqual({
            type: "apikey",
            token: "hk_key",
        });
    });

    it("ignores non-bearer schemes", () => {
        expect(parseAuthHeader({ authorization: "Basic abc" })).toBeUndefined();
    });

    it("returns undefined without credentials", () => {
        expect(parseAuthHeader({})).toBeUndefined();
    });
});

describe("auth plugin", () => {
    const localUser = {
        type: "user" as const,
        userId: "local-user-id",
        nickname: "john",
        scopes: [] as string[],
    };

    async function makeApp(): Promise<FastifyInstance> {
        const app = buildApp({ infrastructure: false, resolveLocalUser: async () => localUser });
        app.register(async (inner) => {
            inner.get(
                "/__test/protected",
                {
                    preHandler: [inner.requireAuth, inner.requireScope("profile:read")],
                },
                async (request) => {
                    return { userId: getAuthenticatedUser(request).userId };
                },
            );
        });
        await app.ready();
        return app;
    }

    it("resolves anonymous requests to the local user", async () => {
        const app = await makeApp();
        const response = await app.inject({ method: "GET", url: "/__test/protected" });
        expect(response.statusCode).toBe(200);
        expect(response.json().userId).toBe("local-user-id");
        await app.close();
    });

    it("accepts a valid bearer token and bypasses scope for user tokens", async () => {
        const app = await makeApp();
        const token = await signAccessToken({ id: "user-1", nickname: "jorge" });
        const response = await app.inject({
            method: "GET",
            url: "/__test/protected",
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().userId).toBe("user-1");
        await app.close();
    });

    it("resolves a non-JWT bearer token to the local user and exposes llmToken", async () => {
        const app = await makeApp();
        const response = await app.inject({
            method: "GET",
            url: "/__test/protected",
            headers: { authorization: "Bearer llm-provider-token-123" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().userId).toBe("local-user-id");
        await app.close();
    });
});
