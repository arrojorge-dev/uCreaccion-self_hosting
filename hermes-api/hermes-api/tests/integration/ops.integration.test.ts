import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { startMockServer } from "../helpers/mock-server.js";

let app: FastifyInstance;
let mock: Awaited<ReturnType<typeof startMockServer>>;
const createdUsers: Array<{ id: string; nickname: string }> = [];

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

async function registerUser(prefix: string): Promise<{ token: string; userId: string }> {
    const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname, password: "password-123" },
    });
    const body = response.json() as {
        user: { id: string };
        tokens: { accessToken: string };
    };
    createdUsers.push({ id: body.user.id, nickname });
    return { token: body.tokens.accessToken, userId: body.user.id };
}

async function createApiKey(token: string, scopes: string[]): Promise<string> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/apikeys",
        headers: bearer(token),
        payload: { name: "test", scopes },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { key: string }).key;
}

beforeAll(async () => {
    await prisma.usageRecord.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.task.deleteMany();
    mock = await startMockServer(() => ({
        json: { id: "resp", status: "completed", output_text: "ok" },
    }));
    const client = new HermesClient({ baseUrl: mock.url, apiKey: "test-key", retries: 0 });
    app = buildApp({ infrastructure: false, hermesClient: client });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await prisma.usageRecord.deleteMany({ where: { userId: { in: createdUsers.map((u) => u.id) } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers.map((u) => u.id) } } });
    await prisma.task.deleteMany();
    await disconnectDatabase();
    await mock.close();
});

describe("prometheus metrics", () => {
    it("exposes counters to a key with the metrics:read scope", async () => {
        const user = await registerUser("metrics");
        const key = await createApiKey(user.token, ["metrics:read"]);

        await app.inject({ method: "GET", url: "/api/v1/tasks", headers: bearer(user.token) });

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
            headers: { "x-api-key": key },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("text/plain");
        expect(response.body).toContain("hermes_http_requests_total");
        expect(response.body).toContain('method="GET"');
    });

    it("requires an api key with the metrics:read scope for legacy keys", async () => {
        const user = await registerUser("metrics-forbidden");
        const limitedKey = await createApiKey(user.token, ["profile:read"]);

        // Local mode: unauthenticated requests resolve to the local user, which can read metrics.
        const localMode = await app.inject({ method: "GET", url: "/metrics" });
        expect(localMode.statusCode).toBe(200);

        const forbidden = await app.inject({
            method: "GET",
            url: "/metrics",
            headers: { "x-api-key": limitedKey },
        });
        expect(forbidden.statusCode).toBe(403);
    });
});

describe("openapi documentation", () => {
    it("requires the docs secret and serves the OpenAPI document", async () => {
        const unauthenticated = await app.inject({ method: "GET", url: "/documentation/json" });
        expect(unauthenticated.statusCode).toBe(401);
        expect(unauthenticated.headers["www-authenticate"]).toContain("Basic");

        const wrongCredentials = await app.inject({
            method: "GET",
            url: "/documentation/json",
            headers: { authorization: `Basic ${Buffer.from("docs:wrong-secret").toString("base64")}` },
        });
        expect(wrongCredentials.statusCode).toBe(401);

        const response = await app.inject({
            method: "GET",
            url: "/documentation/json",
            headers: {
                authorization: `Basic ${Buffer.from("docs:test-docs-secret").toString("base64")}`,
            },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json() as { openapi: string; paths: Record<string, unknown> };
        expect(body.openapi).toBe("3.0.3");
        expect(body.paths["/api/v1/tasks"]).toBeDefined();
        expect(body.paths["/api/v1/webhooks"]).toBeDefined();
        expect(body.paths["/metrics"]).toBeUndefined();
    });
});

describe("rate limit per user", () => {
    it("applies an independent budget to each authenticated user", async () => {
        const userA = await registerUser("rl-a");
        const userB = await registerUser("rl-b");

        const statuses: number[] = [];
        for (let i = 0; i < 21; i++) {
            const response = await app.inject({
                method: "POST",
                url: "/api/v1/tasks",
                headers: bearer(userA.token),
                payload: { model: "hermes-agent", input: "x" },
            });
            statuses.push(response.statusCode);
        }
        const first20 = statuses.slice(0, 20);
        expect(first20.every((status) => status === 201)).toBe(true);
        expect(statuses[20]).toBe(429);

        const responseB = await app.inject({
            method: "POST",
            url: "/api/v1/tasks",
            headers: bearer(userB.token),
            payload: { model: "hermes-agent", input: "x" },
        });
        expect(responseB.statusCode).toBe(201);
    });
});
