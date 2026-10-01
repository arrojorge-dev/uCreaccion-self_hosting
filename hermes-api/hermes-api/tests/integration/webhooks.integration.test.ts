import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { WebhooksService } from "../../src/modules/webhooks/index.js";
import { startMockServer } from "../helpers/mock-server.js";

let app: FastifyInstance;
let hermesMock: Awaited<ReturnType<typeof startMockServer>>;
const createdNicknames: string[] = [];

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

function uniqueNickname(prefix: string): string {
    const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    createdNicknames.push(nickname);
    return nickname;
}

async function registerUser(prefix: string): Promise<{ token: string; nickname: string }> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname: uniqueNickname(prefix), password: "password-123" },
    });
    const body = response.json() as { user: { nickname: string }; tokens: { accessToken: string } };
    return { token: body.tokens.accessToken, nickname: body.user.nickname };
}

beforeAll(async () => {
    await prisma.webhook.deleteMany();
    hermesMock = await startMockServer(() => ({
        json: { id: "resp", status: "completed", output_text: "ok" },
    }));
    const client = new HermesClient({ baseUrl: hermesMock.url, apiKey: "test-key", retries: 0 });
    app = buildApp({
        infrastructure: false,
        hermesClient: client,
        webhooksService: new WebhooksService(),
    });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await prisma.user.deleteMany({ where: { nickname: { in: createdNicknames } } });
    await prisma.webhook.deleteMany();
    await disconnectDatabase();
    await hermesMock.close();
});

describe("webhooks CRUD", () => {
    it("creates a webhook and returns its secret once", async () => {
        const user = await registerUser("wh-create");
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
            payload: { url: "https://example.com/hook", events: ["task.completed"] },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json() as { id: string; secret: string; url: string };
        expect(body.secret.length).toBeGreaterThanOrEqual(32);
        expect(body.url).toBe("https://example.com/hook");

        const stored = await prisma.webhook.findUnique({ where: { id: body.id } });
        expect(stored?.secret).toBe(body.secret);
    });

    it("lists webhooks without exposing the secret", async () => {
        const user = await registerUser("wh-list");
        await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
            payload: { url: "https://example.com/hook-a", events: ["task.completed"] },
        });
        const list = await app.inject({
            method: "GET",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
        });
        expect(list.statusCode).toBe(200);
        const body = list.json() as Array<{ url: string; secret?: string }>;
        expect(body).toHaveLength(1);
        expect(body[0]?.url).toBe("https://example.com/hook-a");
        expect("secret" in (body[0] ?? {})).toBe(false);
    });

    it("updates and deactivates a webhook", async () => {
        const user = await registerUser("wh-update");
        const created = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
            payload: { url: "https://example.com/hook", events: ["task.completed"] },
        });
        const { id } = created.json() as { id: string };

        const patch = await app.inject({
            method: "PATCH",
            url: `/api/v1/webhooks/${id}`,
            headers: bearer(user.token),
            payload: { active: false, url: "https://example.com/hook-new" },
        });
        expect(patch.statusCode).toBe(200);
        const updated = patch.json() as { active: boolean; url: string };
        expect(updated.active).toBe(false);
        expect(updated.url).toBe("https://example.com/hook-new");
    });

    it("deletes a webhook and its deliveries", async () => {
        const user = await registerUser("wh-delete");
        const created = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
            payload: { url: "https://example.com/hook", events: ["task.completed"] },
        });
        const { id } = created.json() as { id: string };

        const del = await app.inject({
            method: "DELETE",
            url: `/api/v1/webhooks/${id}`,
            headers: bearer(user.token),
        });
        expect(del.statusCode).toBe(204);

        const get = await app.inject({
            method: "GET",
            url: `/api/v1/webhooks/${id}`,
            headers: bearer(user.token),
        });
        expect(get.statusCode).toBe(404);
    });

    it("validates event types and urls", async () => {
        const user = await registerUser("wh-validate");
        const badEvent = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
            payload: { url: "https://example.com/hook", events: ["task.exploded"] },
        });
        expect(badEvent.statusCode).toBe(400);

        const badUrl = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(user.token),
            payload: { url: "ftp://example.com/hook", events: ["task.completed"] },
        });
        expect(badUrl.statusCode).toBe(400);
    });

    it("does not expose another user's webhook", async () => {
        const owner = await registerUser("wh-iso-owner");
        const stranger = await registerUser("wh-iso-stranger");
        const created = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: bearer(owner.token),
            payload: { url: "https://example.com/hook", events: ["task.completed"] },
        });
        const { id } = created.json() as { id: string };
        const res = await app.inject({
            method: "GET",
            url: `/api/v1/webhooks/${id}`,
            headers: bearer(stranger.token),
        });
        expect(res.statusCode).toBe(404);
    });
});
