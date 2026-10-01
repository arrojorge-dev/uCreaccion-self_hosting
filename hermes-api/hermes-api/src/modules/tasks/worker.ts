import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import type { Conversation, Prisma, Task } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { mimeTypeFromFilename } from "../../lib/mime.js";
import type { HermesClient } from "../hermes/client.js";
import { toAppError } from "../hermes/errors.js";
import type { HermesResponseCreateParams, HermesUsage } from "../hermes/types.js";
import type { PenaltyService } from "../penalty/index.js";
import type { UsageService } from "../usage/index.js";
import type { TaskEventBus } from "./event-bus.js";
import { toTaskDto } from "./service.js";
import type { TaskResultFile, TaskResultPayload } from "./types.js";

export interface TaskWorkerLogger {
    error(obj: unknown, msg?: string): void;
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
}

export interface TaskWorkerOptions {
    client: HermesClient;
    bus: TaskEventBus;
    pollIntervalMs?: number;
    logger?: TaskWorkerLogger;
    usage?: UsageService;
    penalty?: PenaltyService;
}

function errorInfo(error: unknown): { code: string; message: string } {
    const appError = error instanceof AppError ? error : toAppError(error, "task.run");
    return { code: appError.code, message: appError.message };
}

export class TaskWorker {
    private readonly client: HermesClient;
    private readonly bus: TaskEventBus;
    private readonly pollIntervalMs: number;
    private readonly logger: TaskWorkerLogger;
    private readonly usage: UsageService | undefined;
    private readonly penalty: PenaltyService | undefined;
    private readonly aborts = new Map<string, AbortController>();
    private timer: NodeJS.Timeout | null = null;
    private working = false;
    private stopped = false;

    constructor(options: TaskWorkerOptions) {
        this.client = options.client;
        this.bus = options.bus;
        this.pollIntervalMs = options.pollIntervalMs ?? 250;
        this.logger = options.logger ?? {
            error: () => undefined,
            info: () => undefined,
            warn: () => undefined,
        };
        this.usage = options.usage;
        this.penalty = options.penalty;
        this.bus.subscribe(
            "task.cancel",
            (event) => {
                if (event.type === "task.cancel") {
                    this.aborts.get(event.taskId)?.abort();
                }
            },
            { replay: false },
        );
    }

    start(): void {
        if (this.timer) {
            return;
        }
        this.stopped = false;
        this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
        void this.tick();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        for (const controller of this.aborts.values()) {
            controller.abort();
        }
        this.aborts.clear();
    }

    private async tick(): Promise<void> {
        if (this.working || this.stopped) {
            return;
        }
        this.working = true;
        try {
            await this.processNext();
        } catch (error) {
            this.logger.error({ err: error }, "task worker tick failed");
        } finally {
            this.working = false;
        }
    }

    private async processNext(): Promise<void> {
        const task = await this.claimNext();
        if (!task) {
            return;
        }
        await this.execute(task);
    }

    private async claimNext(): Promise<Task | null> {
        return prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ id: string }>>`
				SELECT id
				FROM "Task"
				WHERE status = 'ENQUEUED'
				  AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
				ORDER BY "createdAt" ASC
				LIMIT 1
				FOR UPDATE SKIP LOCKED`;
            const row = rows[0];
            if (!row) {
                return null;
            }
            return tx.task.update({
                where: { id: row.id },
                data: { status: "RUNNING", startedAt: new Date(), attempt: { increment: 1 } },
            });
        });
    }

    private async execute(claimed: Task): Promise<void> {
        const controller = new AbortController();
        this.aborts.set(claimed.id, controller);
        // Siempre streaming hacia Hermes: al cancelar, cortar la conexión SSE hace
        // que Hermes detecte el disconnect y llame a agent.interrupt(), deteniendo
        // al agente (y a Ollama) de inmediato. El path no-stream de /v1/responses
        // corre en un hilo del executor de Hermes que NO es cancelable.
        // Deadline global: el timeout HTTP del stream solo cubre hasta los headers;
        // HERMES_TIMEOUT_MS acota la duración total de la tarea.
        let timedOut = false;
        const deadline = setTimeout(() => {
            timedOut = true;
            // Avisa a Hermes para que interrumpa al agente (POST /v1/responses/stop,
            // parche api_server_stop): el hilo executor de /v1/responses no es
            // cancelable, así que el abort local solo cortaba nuestra conexión y el
            // agente seguía llamando a Ollama. Best-effort, no bloquea el abort.
            void this.client.stopResponses(claimed.id).catch(() => undefined);
            controller.abort();
        }, env.HERMES_TIMEOUT_MS);
        try {
            const task = await this.loadWithConversation(claimed.id);
            if (task?.status !== "RUNNING") {
                return;
            }
            this.bus.publish(task.id, { type: "task.running", task: toTaskDto(task) });

            const params = this.buildParams(task);
            const emitDeltas = task.stream || this.bus.hasListeners(task.id);
            let text = "";
            let usage: HermesUsage | undefined;
            let budgetExhausted = false;
            for await (const event of this.client.streamResponses(params, {
                signal: controller.signal,
                headers: { "Idempotency-Key": task.id },
            })) {
                if (
                    event.type === "response.output_text.delta" &&
                    typeof event.delta === "string"
                ) {
                    text += event.delta;
                    if (emitDeltas) {
                        this.bus.publish(task.id, {
                            type: "task.output.delta",
                            taskId: task.id,
                            delta: event.delta,
                        });
                    }
                }
                if (event.type === "response.completed") {
                    const response = event.response as
                        | { usage?: HermesUsage; hermes?: { exit_reason?: string } }
                        | undefined;
                    if (response?.usage) {
                        usage = response.usage;
                    }
                    if (response?.hermes?.exit_reason === "input_token_budget_exhausted") {
                        budgetExhausted = true;
                    }
                }
            }

            const current = await prisma.task.findUnique({ where: { id: task.id } });
            if (current?.status === "CANCELLED") {
                return;
            }

            if (env.MAX_INPUT_TOKENS > 0 && budgetExhausted) {
                await this.penalty?.recordBudgetExhausted(task.userId);
                await this.markFailed(task.id, task.userId, {
                    code: "INPUT_TOKEN_BUDGET_EXHAUSTED",
                    message:
                        "Input token budget exhausted: the task exceeded the maximum input tokens allowed.",
                });
                return;
            }

            const outputFile =
                typeof (task.inputPayload as HermesResponseCreateParams).outputFile === "string"
                    ? ((task.inputPayload as HermesResponseCreateParams).outputFile as string)
                    : undefined;

            let files: TaskResultFile[] | undefined;
            if (outputFile) {
                const file = await this.loadOutputFile(outputFile);
                if (!file) {
                    await this.markFailed(task.id, task.userId, {
                        code: "OUTPUT_FILE_ERROR",
                        message: `output file not generated: ${outputFile}`,
                    });
                    return;
                }
                files = [file];
            }

            const resultPayload: TaskResultPayload = outputFile
                ? { files }
                : { text, ...(usage ? { usage } : {}) };

            if (task.conversationId && text.length > 0) {
                await prisma.message.create({
                    data: { conversationId: task.conversationId, role: "ASSISTANT", content: text },
                });
            }
            const done = await prisma.$transaction(async (tx) => {
                const updated = await tx.task.update({
                    where: { id: task.id },
                    data: {
                        status: "SUCCEEDED",
                        resultPayload: resultPayload as unknown as Prisma.InputJsonValue,
                        tokensIn: usage?.input_tokens ?? usage?.prompt_tokens ?? null,
                        tokensOut: usage?.output_tokens ?? usage?.completion_tokens ?? null,
                        completedAt: new Date(),
                    },
                });
                await tx.outboxMessage.create({
                    data: {
                        aggregateType: "Task",
                        aggregateId: task.id,
                        type: "task.completed",
                        payload: {
                            taskId: task.id,
                            userId: task.userId,
                            status: "SUCCEEDED",
                        } as unknown as Prisma.InputJsonValue,
                    },
                });
                await this.usage?.recordTokens(tx, {
                    userId: task.userId,
                    taskId: task.id,
                    model: (task.inputPayload as HermesResponseCreateParams).model,
                    tokensIn: usage?.input_tokens ?? usage?.prompt_tokens ?? null,
                    tokensOut: usage?.output_tokens ?? usage?.completion_tokens ?? null,
                });
                return updated;
            });
            await this.penalty?.resetStreak(task.userId);
            this.bus.publish(task.id, { type: "task.succeeded", task: toTaskDto(done) });
        } catch (error) {
            if (timedOut) {
                await this.markFailed(claimed.id, claimed.userId, {
                    code: "UPSTREAM_TIMEOUT",
                    message: "task.run: upstream timed out",
                });
                return;
            }
            if (controller.signal.aborted) {
                const cancelled = await prisma.task.update({
                    where: { id: claimed.id },
                    data: { status: "CANCELLED", cancelledAt: new Date() },
                });
                this.bus.publish(claimed.id, {
                    type: "task.cancelled",
                    task: toTaskDto(cancelled),
                });
                return;
            }
            await this.handleFailure(claimed.id, error);
        } finally {
            clearTimeout(deadline);
            this.aborts.delete(claimed.id);
        }
    }

    private async handleFailure(taskId: string, error: unknown): Promise<void> {
        const current = await prisma.task.findUnique({ where: { id: taskId } });
        if (!current) {
            return;
        }
        // Sin reintento automático: al primer fallo la tarea queda FAILED, se notifica
        // vía outbox (task.failed → notificación) y ahí termina. El reintento solo existe
        // a petición del usuario (crear una tarea nueva). `maxAttempts`/`nextAttemptAt`
        // quedan como columnas legacy sin efecto (sin migraciones).
        const info = errorInfo(error);
        await this.markFailed(taskId, current.userId, info);
    }

    private async markFailed(
        taskId: string,
        userId: string,
        info: { code: string; message: string },
    ): Promise<void> {
        const failed = await prisma.$transaction(async (tx) => {
            const updated = await tx.task.update({
                where: { id: taskId },
                data: {
                    status: "FAILED",
                    lastError: info as unknown as Prisma.InputJsonValue,
                    completedAt: new Date(),
                },
            });
            await tx.outboxMessage.create({
                data: {
                    aggregateType: "Task",
                    aggregateId: taskId,
                    type: "task.completed",
                    payload: {
                        taskId,
                        userId,
                        status: "FAILED",
                    } as unknown as Prisma.InputJsonValue,
                },
            });
            return updated;
        });
        this.bus.publish(taskId, { type: "task.failed", task: toTaskDto(failed) });
    }

    private sanitizeFilename(name: string): string {
        // Basename seguro: conserva puntos/guiones (nombres reales tipo "informe.pdf");
        // "." y ".." se rechazan como traversal.
        const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "");
        return cleaned === "." || cleaned === ".." ? "" : cleaned;
    }

    private async loadOutputFile(outputFile: string): Promise<TaskResultFile | null> {
        const sanitized = this.sanitizeFilename(outputFile);
        if (!/^[^/\\]+$/.test(sanitized) || sanitized.length === 0) {
            return null;
        }
        const filePath = join(env.OUTPUT_FILE_DIR, sanitized);
        try {
            const info = await stat(filePath);
            if (!info.isFile() || info.size > env.TASK_OUTPUT_FILE_MAX_BYTES) {
                return null;
            }
            const data = await readFile(filePath);
            return {
                name: sanitized,
                mimeType: mimeTypeFromFilename(sanitized),
                size: data.byteLength,
                dataBase64: data.toString("base64"),
            };
        } catch {
            return null;
        }
    }

    private async loadWithConversation(
        taskId: string,
    ): Promise<(Task & { conversation: Conversation | null }) | null> {
        return prisma.task.findUnique({
            where: { id: taskId },
            include: { conversation: true },
        });
    }

    private buildParams(
        task: Task & { conversation: Conversation | null },
    ): HermesResponseCreateParams {
        const payload = task.inputPayload as HermesResponseCreateParams;
        const outputFileRaw =
            typeof payload.outputFile === "string" ? payload.outputFile : undefined;
        const outputFile = outputFileRaw ? this.sanitizeFilename(outputFileRaw) : undefined;
        const instructions = [
            ...(payload.instructions ? [payload.instructions] : []),
            ...(outputFile
                ? [
                      `Guarda el archivo resultante en /opt/data/outputs/${outputFile} (ruta dentro de HERMES_WRITE_SAFE_ROOT).`,
                  ]
                : []),
        ];
        return {
            model: payload.model || env.PREFERRED_MODEL,
            input: payload.input,
            ...(instructions.length > 0 ? { instructions: instructions.join("\n") } : {}),
            ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
            ...(payload.max_output_tokens !== undefined
                ? { max_output_tokens: payload.max_output_tokens }
                : {}),
            ...(task.conversation?.hermesSessionId
                ? { session_id: task.conversation.hermesSessionId }
                : {}),
            ...(payload.api_key ? { api_key: payload.api_key } : {}),
            ...(payload.base_url ? { base_url: payload.base_url } : {}),
        };
    }
}
