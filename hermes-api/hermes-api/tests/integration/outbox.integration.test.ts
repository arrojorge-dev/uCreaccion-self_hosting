import "dotenv/config";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { verifyWebhookSignature } from "../../src/lib/hmac.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { NotificationsService } from "../../src/modules/notifications/index.js";
import {
    createTaskCompletedHandler,
    OutboxDispatcher,
    OutboxService,
} from "../../src/modules/outbox/index.js";
import { taskEventBus, TaskWorker } from "../../src/modules/tasks/index.js";
import { WebhookSender, WebhooksService } from "../../src/modules/webhooks/index.js";
import { startMockServer, type MockResponse } from "../helpers/mock-server.js";

interface UserCtx {
    token: string;
    nickname: string;
    userId: string;
}

interface TargetCapture {
    url: string | undefined;
    headers: IncomingMessage["headers"];
    body: string;
}

let app: FastifyInstance;
let worker: TaskWorker;
let outboxDispatcher: OutboxDispatcher;
let webhookSender: WebhookSender;
let notifications: NotificationsService;
let webhooks: WebhooksService;
let outboxService: OutboxService;
let hermesMock: Awaited<ReturnType<typeof startMockServer>>;
let targetMock: Awaited<ReturnType<typeof startMockServer>>;
let hermesHandler: (req: IncomingMessage, body: string) => MockResponse;
let targetHandler: (req: IncomingMessage, body: string) => MockResponse;
const targetRequests: TargetCapture[] = [];
const createdNicknames: string[] = [];

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

function uniqueNickname(prefix: string): string {
    const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    createdNicknames.push(nickname);
    return nickname;
}

async function registerUser(prefix: string): Promise<UserCtx> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname: uniqueNickname(prefix), password: "password-123" },
    });
    const body = response.json() as {
        user: { id: string; nickname: string };
        tokens: { accessToken: string };
    };
    return {
        token: body.tokens.accessToken,
        nickname: body.user.nickname,
        userId: body.user.id,
    };
}

async function createWebhook(
    user: UserCtx,
    url: string,
    events = ["task.completed"],
): Promise<{ id: string; secret: string }> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks",
        headers: bearer(user.token),
        payload: { url, events },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; secret: string };
}

async function createSucceededTask(user: UserCtx): Promise<string> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: bearer(user.token),
        payload: { model: "hermes-agent", input: "hola" },
    });
    expect(response.statusCode).toBe(201);
    const id = (response.json() as { id: string }).id;
    const deadline = Date.now() + 10_000;
    for (;;) {
        const check = await app.inject({
            method: "GET",
            url: `/api/v1/tasks/${id}`,
            headers: bearer(user.token),
        });
        const body = check.json() as { status: string };
        if (body.status === "SUCCEEDED") {
            return id;
        }
        if (Date.now() > deadline) {
            throw new Error(`task ${id} did not reach SUCCEEDED`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

async function waitFor(
    predicate: () => Promise<boolean>,
    message: string,
    timeoutMs = 25_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await predicate()) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`timeout: ${message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

beforeAll(async () => {
    await prisma.outboxMessage.deleteMany();
    await prisma.webhookDelivery.deleteMany();
    await prisma.webhook.deleteMany();
    await prisma.notification.deleteMany();

    hermesMock = await startMockServer((req, body) => hermesHandler(req, body));
    targetMock = await startMockServer(async (req, body) => {
        targetRequests.push({ url: req.url, headers: req.headers, body });
        return targetHandler(req, body);
    });
    hermesHandler = () => ({
        json: { id: "resp", status: "completed", output_text: "ok" },
    });
    targetHandler = () => ({ status: 200, text: "ok" });

    const client = new HermesClient({ baseUrl: hermesMock.url, apiKey: "test-key", retries: 0 });
    notifications = new NotificationsService();
    webhooks = new WebhooksService();
    outboxService = new OutboxService();
    app = buildApp({ infrastructure: false, hermesClient: client, notificationsService: notifications, webhooksService: webhooks });

    worker = new TaskWorker({ client, bus: taskEventBus, pollIntervalMs: 10 });
    outboxDispatcher = new OutboxDispatcher({
        handlers: {
            "task.completed": createTaskCompletedHandler({ notifications, webhooks }),
        },
        pollIntervalMs: 10,
        maxAttempts: 3,
        retryBaseMs: 10,
        logger: app.log,
    });
    webhookSender = new WebhookSender({
        pollIntervalMs: 10,
        maxAttempts: 3,
        retryBaseMs: 10,
        logger: app.log,
    });
    worker.start();
    outboxDispatcher.start();
    webhookSender.start();
    await app.ready();
});

afterAll(async () => {
    await Promise.all([worker.stop(), outboxDispatcher.stop(), webhookSender.stop()]);
    await app.close();
    await prisma.user.deleteMany({ where: { nickname: { in: createdNicknames } } });
    await prisma.outboxMessage.deleteMany();
    await prisma.webhookDelivery.deleteMany();
    await prisma.webhook.deleteMany();
    await prisma.notification.deleteMany();
    await disconnectDatabase();
    await hermesMock.close();
    await targetMock.close();
});

describe("task.completed outbox flow", () => {
    it("creates a notification and delivers a signed webhook exactly once", async () => {
        targetRequests.length = 0;
        const user = await registerUser("flow");
        const webhook = await createWebhook(user, `${targetMock.url}/hook`);

        const taskId = await createSucceededTask(user);

        await waitFor(async () => {
            const count = await prisma.webhookDelivery.count({ where: { status: "DELIVERED" } });
            return count === 1;
        }, "webhook delivery to be delivered");

        const delivery = await prisma.webhookDelivery.findFirst({
            where: { webhookId: webhook.id },
        });
        expect(delivery).not.toBeNull();
        expect(delivery?.status).toBe("DELIVERED");
        expect(delivery?.attempts).toBe(1);

        const request = targetRequests.find((entry) => entry.url === "/hook");
        expect(request).toBeDefined();
        const headers = request?.headers ?? {};
        expect(headers["x-hermes-event"]).toBe("task.completed");
        expect(headers["x-hermes-event-id"]).toBe(delivery?.outboxMessageId);
        expect(headers["x-hermes-delivery-id"]).toBe(delivery?.id);
        const signature = headers["x-hermes-signature"];
        expect(typeof signature).toBe("string");
        expect(
            verifyWebhookSignature(webhook.secret, request?.body ?? "", signature as string),
        ).toBe(true);
        expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
            taskId,
            status: "SUCCEEDED",
        });

        const notification = await prisma.notification.findFirst({
            where: { userId: user.userId },
        });
        expect(notification).not.toBeNull();
        expect(notification?.type).toBe("task.completed");
        expect(notification?.outboxMessageId).toBe(delivery?.outboxMessageId);
        expect(notification?.readAt).toBeNull();

        const outbox = await prisma.outboxMessage.findUnique({
            where: { id: delivery?.outboxMessageId ?? "" },
        });
        expect(outbox?.status).toBe("DISPATCHED");

        expect(targetRequests.filter((entry) => entry.url === "/hook")).toHaveLength(1);
    });
});

describe("webhook retries and dead-letter", () => {
    it("moves a delivery to DEAD after exhausting attempts and redelivers it", async () => {
        targetHandler = () => ({ status: 500, text: "boom" });
        const user = await registerUser("dead");
        const webhook = await createWebhook(user, `${targetMock.url}/retry`);

        await createSucceededTask(user);

        await waitFor(async () => {
            const dead = await prisma.webhookDelivery.count({ where: { status: "DEAD" } });
            return dead === 1;
        }, "delivery to reach DEAD");

        const dead = await prisma.webhookDelivery.findFirst({
            where: { webhookId: webhook.id },
        });
        expect(dead?.status).toBe("DEAD");
        expect((dead?.attempts ?? 0) >= 3).toBe(true);
        expect(dead?.lastError).toBeTruthy();

        targetHandler = () => ({ status: 200, text: "ok" });
        const redeliver = await app.inject({
            method: "POST",
            url: `/api/v1/webhooks/${webhook.id}/deliveries/${dead?.id}/redeliver`,
            headers: bearer(user.token),
        });
        expect(redeliver.statusCode).toBe(204);

        await waitFor(async () => {
            const delivered = await prisma.webhookDelivery.findUnique({
                where: { id: dead?.id ?? "" },
            });
            return delivered?.status === "DELIVERED";
        }, "redelivered delivery to succeed");

        const redelivered = await prisma.webhookDelivery.findUnique({
            where: { id: dead?.id ?? "" },
        });
        expect(redelivered?.status).toBe("DELIVERED");
        expect(redelivered?.attempts).toBe(1);
    });
});

describe("concurrent dispatchers", () => {
    it("do not duplicate deliveries or notifications", async () => {
        targetRequests.length = 0;
        const user = await registerUser("concurrent");
        await createWebhook(user, `${targetMock.url}/conc`);

        const count = 10;
        const messageIds: string[] = [];
        for (let i = 0; i < count; i++) {
            const message = await outboxService.enqueue({
                aggregateType: "Task",
                aggregateId: `task-${i}`,
                type: "task.completed",
                payload: { taskId: `task-${i}`, userId: user.userId, status: "SUCCEEDED" },
            });
            messageIds.push(message.id);
        }

        const extraA = new OutboxDispatcher({
            handlers: {
                "task.completed": createTaskCompletedHandler({ notifications, webhooks }),
            },
            pollIntervalMs: 10,
            maxAttempts: 3,
            retryBaseMs: 10,
            logger: app.log,
        });
        const extraB = new OutboxDispatcher({
            handlers: {
                "task.completed": createTaskCompletedHandler({ notifications, webhooks }),
            },
            pollIntervalMs: 10,
            maxAttempts: 3,
            retryBaseMs: 10,
            logger: app.log,
        });
        extraA.start();
        extraB.start();

        try {
            await waitFor(
                async () =>
                    (await prisma.outboxMessage.count({
                        where: { id: { in: messageIds }, status: "DISPATCHED" },
                    })) === count,
                "all outbox messages dispatched",
                20_000,
            );
        } catch (error) {
            const states = await prisma.outboxMessage.findMany({
                where: { id: { in: messageIds } },
                select: { status: true, attempts: true, lastError: true },
            });
            throw new Error(`${String(error)}\noutbox states: ${JSON.stringify(states)}`);
        } finally {
            await extraA.stop();
            await extraB.stop();
        }

        const notificationsForUser = await prisma.notification.count({
            where: { userId: user.userId },
        });
        expect(notificationsForUser).toBe(count);

        const deliveries = await prisma.webhookDelivery.count({
            where: { webhookId: (await prisma.webhook.findFirst({ where: { userId: user.userId } }))?.id },
        });
        expect(deliveries).toBe(count);

        await waitFor(async () => targetRequests.length === count, "all webhook deliveries received", 20_000);
        expect(targetRequests.filter((entry) => entry.url === "/conc")).toHaveLength(count);
    });
});
