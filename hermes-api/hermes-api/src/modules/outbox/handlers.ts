import type { PrismaClient } from "../../generated/prisma/client.js";
import { isPrismaError, prisma } from "../../lib/db.js";
import type { NotificationsService } from "../notifications/service.js";
import type { WebhooksService } from "../webhooks/service.js";
import type { OutboxHandler } from "./types.js";

const FAILED_BODY = "Tu tarea no se pudo completar.";
const DEFAULT_SUCCEEDED_BODY = "Tu tarea ha terminado correctamente.";
const SUMMARY_MAX_CHARS = 120;

interface TaskPayloads {
    inputPayload: { outputFile?: string } | null;
    resultPayload: { files?: Array<{ name?: string }>; text?: string } | null;
}

function summarizeText(text: string): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    return collapsed.length > SUMMARY_MAX_CHARS
        ? `${collapsed.slice(0, SUMMARY_MAX_CHARS)}…`
        : collapsed;
}

async function succeededBody(db: PrismaClient, taskId: string): Promise<string> {
    try {
        const task = (await db.task.findUnique({
            where: { id: taskId },
            select: { inputPayload: true, resultPayload: true },
        })) as TaskPayloads | null;
        if (!task) {
            return DEFAULT_SUCCEEDED_BODY;
        }
        const fileName = task.inputPayload?.outputFile ?? task.resultPayload?.files?.[0]?.name;
        if (fileName) {
            return `Tu fichero "${fileName}" está listo.`;
        }
        const text = task.resultPayload?.text;
        if (typeof text === "string" && text.trim().length > 0) {
            return summarizeText(text);
        }
        return DEFAULT_SUCCEEDED_BODY;
    } catch {
        return DEFAULT_SUCCEEDED_BODY;
    }
}

export function createTaskCompletedHandler(options: {
    notifications: NotificationsService;
    webhooks: WebhooksService;
    db?: PrismaClient;
}): OutboxHandler {
    const db = options.db ?? prisma;
    return async (message) => {
        const payload = message.payload as { taskId?: string; userId?: string; status?: string };
        if (!payload.userId || !payload.taskId || !payload.status) {
            return;
        }
        // Solo SUCCEEDED/FAILED: nunca CANCELLED (el worker no encola CANCELLED; guard defensivo).
        if (payload.status !== "SUCCEEDED" && payload.status !== "FAILED") {
            return;
        }
        const succeeded = payload.status === "SUCCEEDED";
        // El body de FAILED es fijo y corto: nunca se incluyen detalles internos (lastError).
        const body = succeeded ? await succeededBody(db, payload.taskId) : FAILED_BODY;
        try {
            await options.notifications.create(payload.userId, {
                type: "task.completed",
                title: succeeded ? "Tarea completada" : "La tarea falló",
                body,
                payload: { taskId: payload.taskId, status: payload.status },
                outboxMessageId: message.id,
            });
        } catch (error) {
            if (!isPrismaError(error, "P2002")) {
                throw error;
            }
        }

        const webhooks = await options.webhooks.listActiveByUserAndEvent(
            payload.userId,
            "task.completed",
        );
        for (const webhook of webhooks) {
            try {
                await options.webhooks.createDelivery({
                    webhookId: webhook.id,
                    outboxMessageId: message.id,
                    eventType: "task.completed",
                    payload: {
                        taskId: payload.taskId,
                        status: payload.status,
                        userId: payload.userId,
                    },
                });
            } catch (error) {
                if (!isPrismaError(error, "P2002")) {
                    throw error;
                }
            }
        }
    };
}
