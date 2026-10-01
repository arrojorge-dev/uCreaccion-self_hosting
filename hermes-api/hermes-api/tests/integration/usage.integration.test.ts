import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { QuotaConfig } from "../../src/common/quotas.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { taskEventBus, TaskWorker } from "../../src/modules/tasks/index.js";
import { UsageService } from "../../src/modules/usage/index.js";
import { startMockServer, type MockResponse } from "../helpers/mock-server.js";

interface UserCtx {
    token: string;
    userId: string;
    nickname: string;
}

let app: FastifyInstance;
let worker: TaskWorker;
let mock: Awaited<ReturnType<typeof startMockServer>>;
let currentHandler: (body: string) => MockResponse;
const createdUsers: Array<{ id: string; nickname: string }> = [];

const tinyQuota: QuotaConfig = {
    FREE: { requestsPerWindow: 3, tokensPerWindow: 1000 },
    PRO: { requestsPerWindow: 10, tokensPerWindow: 5000 },
};

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

async function registerUser(prefix: string): Promise<UserCtx> {
    const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname, password: "password-123" },
    });
    const body = response.json() as {
        user: { id: string; nickname: string };
        tokens: { accessToken: string };
    };
    createdUsers.push({ id: body.user.id, nickname: body.user.nickname });
    return { token: body.tokens.accessToken, userId: body.user.id, nickname: body.user.nickname };
}

async function createTask(token: string, input: Record<string, unknown> = { model: "hermes-agent", input: "x" }) {
    return app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: bearer(token),
        payload: input,
    });
}

async function waitForTaskStatus(token: string, taskId: string, expected: string): Promise<void> {
    const deadline = Date.now() + 25_000;
    for (;;) {
        const response = await app.inject({
            method: "GET",
            url: `/api/v1/tasks/${taskId}`,
            headers: bearer(token),
        });
        const body = response.json() as { status: string };
        if (body.status === expected) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`task ${taskId} did not reach ${expected}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

beforeAll(async () => {
    await prisma.usageRecord.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.outboxMessage.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.webhookDelivery.deleteMany();
    await prisma.webhook.deleteMany();

    mock = await startMockServer((_req, body) => currentHandler(body));
    currentHandler = () => ({
        json: {
            id: "resp",
            status: "completed",
            output_text: "ok",
            usage: { input_tokens: 3, output_tokens: 5 },
        },
    });

    const client = new HermesClient({ baseUrl: mock.url, apiKey: "test-key", retries: 0 });
    const usage = new UsageService(undefined, tinyQuota);
    app = buildApp({ infrastructure: false, hermesClient: client, usageService: usage });
    worker = new TaskWorker({ client, bus: taskEventBus, pollIntervalMs: 10, usage });
    worker.start();
    await app.ready();
});

afterAll(async () => {
    await worker.stop();
    await app.close();
    await prisma.usageRecord.deleteMany({ where: { userId: { in: createdUsers.map((u) => u.id) } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers.map((u) => u.id) } } });
    await prisma.outboxMessage.deleteMany();
    await prisma.webhookDelivery.deleteMany();
    await prisma.webhook.deleteMany();
    await prisma.notification.deleteMany();
    await disconnectDatabase();
    await mock.close();
});

describe("plan quotas", () => {
    it("rejects task creation once the request quota is exhausted", async () => {
        const user = await registerUser("quota");
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
            const response = await createTask(user.token);
            statuses.push(response.statusCode);
        }
        expect(statuses.slice(0, 3)).toEqual([201, 201, 201]);
        expect(statuses[3]).toBe(429);
        const body = (await app.inject({
            method: "POST",
            url: "/api/v1/tasks",
            headers: bearer(user.token),
            payload: { model: "hermes-agent", input: "x" },
        })).json() as { error: { code: string; reason: string } };
        expect(body.error.code).toBe("QUOTA_EXCEEDED");
    });

    it("records request and token usage for completed tasks", async () => {
        const user = await registerUser("usage");
        const created = await createTask(user.token);
        expect(created.statusCode).toBe(201);
        const taskId = (created.json() as { id: string }).id;
        await waitForTaskStatus(user.token, taskId, "SUCCEEDED");

        const requests = await prisma.usageRecord.findMany({
            where: { userId: user.userId, kind: "REQUESTS" },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ taskId, amount: 1, model: "hermes-agent" });

        const tokens = await prisma.usageRecord.findMany({
            where: { userId: user.userId, kind: "TOKENS" },
        });
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ taskId, amount: 8, tokensIn: 3, tokensOut: 5 });
    });
});

describe("audit trail", () => {
    it("records task and webhook mutations with the request id", async () => {
        const user = await registerUser("audit");
        const requestId = `audit-${Date.now()}`;

        const created = await app.inject({
            method: "POST",
            url: "/api/v1/tasks",
            headers: { ...bearer(user.token), "x-request-id": requestId },
            payload: { model: "hermes-agent", input: "x" },
        });
        const taskId = (created.json() as { id: string }).id;

        const webhook = await app.inject({
            method: "POST",
            url: "/api/v1/webhooks",
            headers: { ...bearer(user.token), "x-request-id": requestId },
            payload: { url: "https://example.com/hook", events: ["task.completed"] },
        });
        const webhookId = (webhook.json() as { id: string }).id;

        const taskAudit = await prisma.auditLog.findFirst({
            where: { userId: user.userId, action: "task.created", resourceId: taskId },
        });
        expect(taskAudit).not.toBeNull();
        expect(taskAudit?.requestId).toBe(requestId);
        expect(taskAudit?.actorType).toBe("USER");
        expect(taskAudit?.actorId).toBe(user.userId);

        const webhookAudit = await prisma.auditLog.findFirst({
            where: { userId: user.userId, action: "webhook.created", resourceId: webhookId },
        });
        expect(webhookAudit?.requestId).toBe(requestId);
    });

    it("records cancellation of a running task", async () => {
        currentHandler = () => ({
            json: { id: "resp-slow", status: "completed", output_text: "late" },
            delayMs: 5000,
        });
        const user = await registerUser("audit-cancel");
        const created = await createTask(user.token);
        const taskId = (created.json() as { id: string }).id;

        const deadline = Date.now() + 25_000;
        for (;;) {
            const check = await app.inject({
                method: "GET",
                url: `/api/v1/tasks/${taskId}`,
                headers: bearer(user.token),
            });
            const body = check.json() as { status: string };
            if (body.status === "RUNNING") {
                break;
            }
            if (Date.now() > deadline) {
                throw new Error("task did not reach RUNNING");
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }

        const cancel = await app.inject({
            method: "POST",
            url: `/api/v1/tasks/${taskId}/cancel`,
            headers: bearer(user.token),
        });
        expect(cancel.statusCode).toBe(204);

        const audit = await prisma.auditLog.findFirst({
            where: { userId: user.userId, action: "task.cancelled", resourceId: taskId },
        });
        expect(audit).not.toBeNull();
        expect(audit?.requestId).toBeTruthy();
        currentHandler = () => ({
            json: {
                id: "resp",
                status: "completed",
                output_text: "ok",
                usage: { input_tokens: 3, output_tokens: 5 },
            },
        });
    });
});
