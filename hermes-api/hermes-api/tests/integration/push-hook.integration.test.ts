import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/lib/crypto.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import {
    NotificationsService,
    type PushNotification,
    type PushProvider,
} from "../../src/modules/notifications/index.js";
import {
    createTaskCompletedHandler,
    OutboxDispatcher,
    OutboxService,
} from "../../src/modules/outbox/index.js";
import { WebhooksService } from "../../src/modules/webhooks/index.js";

class RecordingPushProvider implements PushProvider {
    readonly sent: Array<{ userId: string; notification: PushNotification }> = [];

    async send(userId: string, notification: PushNotification): Promise<void> {
        this.sent.push({ userId, notification });
    }
}

let dispatcher: OutboxDispatcher;
let outboxService: OutboxService;
let push: RecordingPushProvider;
let userId: string;
const nickname = `push-hook-${Date.now().toString(36)}`;

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
    await prisma.notification.deleteMany();

    const user = await prisma.user.create({
        data: { nickname, passwordHash: await hashPassword("password-123") },
    });
    userId = user.id;

    push = new RecordingPushProvider();
    const notifications = new NotificationsService(prisma, push);
    const webhooks = new WebhooksService();
    outboxService = new OutboxService();
    dispatcher = new OutboxDispatcher({
        handlers: {
            "task.completed": createTaskCompletedHandler({ notifications, webhooks }),
        },
        pollIntervalMs: 10,
        maxAttempts: 3,
        retryBaseMs: 10,
    });
    dispatcher.start();
});

afterAll(async () => {
    await dispatcher.stop();
    await prisma.outboxMessage.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { nickname } });
    await disconnectDatabase();
});

describe("hook task.completed → notificación in-app + push", () => {
    it("SUCCEEDED notifica con el nombre del fichero y envía push", async () => {
        const task = await prisma.task.create({
            data: {
                userId,
                status: "SUCCEEDED",
                inputPayload: { model: "hermes-agent", input: "genera informe", outputFile: "informe.pdf" },
                resultPayload: { files: [{ name: "informe.pdf", mimeType: "application/pdf", size: 10 }] },
            },
        });
        const message = await outboxService.enqueue({
            aggregateType: "Task",
            aggregateId: task.id,
            type: "task.completed",
            payload: { taskId: task.id, userId, status: "SUCCEEDED" },
        });

        await waitFor(
            async () =>
                (await prisma.outboxMessage.findUnique({ where: { id: message.id } }))?.status ===
                "DISPATCHED",
            "mensaje SUCCEEDED despachado",
        );

        const notification = await prisma.notification.findFirst({
            where: { userId, payload: { path: ["taskId"], equals: task.id } },
        });
        expect(notification).not.toBeNull();
        expect(notification?.title).toBe("Tarea completada");
        expect(notification?.body).toBe('Tu fichero "informe.pdf" está listo.');

        const sent = push.sent.find(
            (entry) => (entry.notification.payload as { taskId?: string }).taskId === task.id,
        );
        expect(sent).toBeDefined();
        expect(sent?.notification.type).toBe("task.completed");
        expect(sent?.notification.title).toBe("Tarea completada");
        expect(sent?.notification.payload).toEqual({ taskId: task.id, status: "SUCCEEDED" });
    });

    it("FAILED notifica con body sanitizado y envía push", async () => {
        const task = await prisma.task.create({
            data: {
                userId,
                status: "FAILED",
                inputPayload: { model: "hermes-agent", input: "algo" },
                lastError: { code: "UPSTREAM_TIMEOUT", message: "detalle interno secreto" },
            },
        });
        const message = await outboxService.enqueue({
            aggregateType: "Task",
            aggregateId: task.id,
            type: "task.completed",
            payload: { taskId: task.id, userId, status: "FAILED" },
        });

        await waitFor(
            async () =>
                (await prisma.outboxMessage.findUnique({ where: { id: message.id } }))?.status ===
                "DISPATCHED",
            "mensaje FAILED despachado",
        );

        const notification = await prisma.notification.findFirst({
            where: { userId, payload: { path: ["taskId"], equals: task.id } },
        });
        expect(notification?.title).toBe("La tarea falló");
        expect(notification?.body).toBe("Tu tarea no se pudo completar.");
        expect(notification?.body).not.toContain("secreto");

        const sent = push.sent.find(
            (entry) => (entry.notification.payload as { taskId?: string }).taskId === task.id,
        );
        expect(sent).toBeDefined();
        expect(sent?.notification.payload).toEqual({ taskId: task.id, status: "FAILED" });
    });

    it("CANCELLED se despacha sin notificación ni push (guard defensivo)", async () => {
        const task = await prisma.task.create({
            data: {
                userId,
                status: "CANCELLED",
                inputPayload: { model: "hermes-agent", input: "algo" },
            },
        });
        const pushBefore = push.sent.length;
        const message = await outboxService.enqueue({
            aggregateType: "Task",
            aggregateId: task.id,
            type: "task.completed",
            payload: { taskId: task.id, userId, status: "CANCELLED" },
        });

        await waitFor(
            async () =>
                (await prisma.outboxMessage.findUnique({ where: { id: message.id } }))?.status ===
                "DISPATCHED",
            "mensaje CANCELLED despachado",
        );

        const notification = await prisma.notification.findFirst({
            where: { userId, payload: { path: ["taskId"], equals: task.id } },
        });
        expect(notification).toBeNull();
        expect(push.sent).toHaveLength(pushBefore);
    });
});
