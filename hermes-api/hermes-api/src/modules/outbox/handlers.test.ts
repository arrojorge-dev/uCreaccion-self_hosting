import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { NotificationsService } from "../notifications/service.js";
import type { CreateNotificationInput } from "../notifications/types.js";
import type { WebhooksService } from "../webhooks/service.js";
import { createTaskCompletedHandler } from "./handlers.js";
import type { OutboxHandlerContext } from "./types.js";

interface CapturedCreate {
    userId: string;
    input: CreateNotificationInput;
}

function fakeNotifications(captured: CapturedCreate[]): NotificationsService {
    return {
        create: async (userId: string, input: CreateNotificationInput) => {
            captured.push({ userId, input });
            return {} as never;
        },
    } as unknown as NotificationsService;
}

function fakeWebhooks(): WebhooksService {
    return {
        listActiveByUserAndEvent: async () => [],
        createDelivery: async () => {
            throw new Error("should not be called");
        },
    } as unknown as WebhooksService;
}

function fakeDb(task: unknown): PrismaClient {
    return {
        task: {
            findUnique: async () => task,
        },
    } as unknown as PrismaClient;
}

function message(payload: unknown): OutboxHandlerContext {
    return {
        id: "outbox-1",
        aggregateType: "Task",
        aggregateId: "task-1",
        type: "task.completed",
        payload,
    };
}

describe("createTaskCompletedHandler", () => {
    it("no notifica con status CANCELLED", async () => {
        const captured: CapturedCreate[] = [];
        const handler = createTaskCompletedHandler({
            notifications: fakeNotifications(captured),
            webhooks: fakeWebhooks(),
            db: fakeDb(null),
        });

        await handler(message({ taskId: "task-1", userId: "user-1", status: "CANCELLED" }));

        expect(captured).toHaveLength(0);
    });

    it("ignora payloads incompletos", async () => {
        const captured: CapturedCreate[] = [];
        const handler = createTaskCompletedHandler({
            notifications: fakeNotifications(captured),
            webhooks: fakeWebhooks(),
            db: fakeDb(null),
        });

        await handler(message({ taskId: "task-1", userId: "user-1" }));

        expect(captured).toHaveLength(0);
    });

    it("SUCCEEDED usa el nombre del outputFile como body", async () => {
        const captured: CapturedCreate[] = [];
        const handler = createTaskCompletedHandler({
            notifications: fakeNotifications(captured),
            webhooks: fakeWebhooks(),
            db: fakeDb({
                inputPayload: { outputFile: "informe.pdf" },
                resultPayload: { files: [{ name: "informe.pdf" }] },
            }),
        });

        await handler(message({ taskId: "task-1", userId: "user-1", status: "SUCCEEDED" }));

        expect(captured).toHaveLength(1);
        expect(captured[0]?.input.title).toBe("Tarea completada");
        expect(captured[0]?.input.body).toBe('Tu fichero "informe.pdf" está listo.');
        expect(captured[0]?.input.payload).toEqual({ taskId: "task-1", status: "SUCCEEDED" });
    });

    it("SUCCEEDED sin outputFile usa un resumen del texto", async () => {
        const captured: CapturedCreate[] = [];
        const longText = `línea1\nlínea2 ${"x".repeat(300)}`;
        const handler = createTaskCompletedHandler({
            notifications: fakeNotifications(captured),
            webhooks: fakeWebhooks(),
            db: fakeDb({ inputPayload: {}, resultPayload: { text: longText } }),
        });

        await handler(message({ taskId: "task-1", userId: "user-1", status: "SUCCEEDED" }));

        const body = captured[0]?.input.body ?? "";
        expect(body.length).toBeLessThanOrEqual(121);
        expect(body.endsWith("…")).toBe(true);
        expect(body.includes("\n")).toBe(false);
    });

    it("SUCCEEDED sin task usa el body por defecto", async () => {
        const captured: CapturedCreate[] = [];
        const handler = createTaskCompletedHandler({
            notifications: fakeNotifications(captured),
            webhooks: fakeWebhooks(),
            db: fakeDb(null),
        });

        await handler(message({ taskId: "task-1", userId: "user-1", status: "SUCCEEDED" }));

        expect(captured[0]?.input.body).toBe("Tu tarea ha terminado correctamente.");
    });

    it("FAILED usa body fijo sanitizado sin detalles internos", async () => {
        const captured: CapturedCreate[] = [];
        const handler = createTaskCompletedHandler({
            notifications: fakeNotifications(captured),
            webhooks: fakeWebhooks(),
            db: fakeDb({
                inputPayload: {},
                resultPayload: null,
            }),
        });

        await handler(message({ taskId: "task-1", userId: "user-1", status: "FAILED" }));

        expect(captured[0]?.input.title).toBe("La tarea falló");
        expect(captured[0]?.input.body).toBe("Tu tarea no se pudo completar.");
    });
});
