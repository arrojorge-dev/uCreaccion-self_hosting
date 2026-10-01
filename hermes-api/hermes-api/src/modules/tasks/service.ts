import { AppError } from "../../common/errors/app-error.js";
import { errorCodes } from "../../common/errors/codes.js";
import { env } from "../../config/env.js";
import type { Prisma, PrismaClient, Task } from "../../generated/prisma/client.js";
import { isPrismaError, prisma } from "../../lib/db.js";
import { type AuditService, type AuditSource, auditEntry } from "../audit/index.js";
import type { ConversationsService } from "../conversations/service.js";
import type { HermesInputItem, HermesResponseCreateParams } from "../hermes/types.js";
import type { PenaltyService } from "../penalty/index.js";
import type { UsageService } from "../usage/index.js";
import type { TaskEventBus } from "./event-bus.js";
import type { CreateTaskInput, TaskDto, TaskErrorInfo, TaskResultPayload } from "./types.js";

export function inputText(input: string | HermesInputItem[]): string {
    if (typeof input === "string") {
        return input;
    }
    return input
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .filter((text) => text.length > 0)
        .join("\n");
}

const CHARS_PER_TOKEN = 4;

export function normalizeBaseUrl(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) {
        return url;
    }
    const queryIndex = trimmed.indexOf("?");
    const query = queryIndex === -1 ? undefined : trimmed.slice(queryIndex + 1);
    const pathPart = queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex);
    const path = pathPart.replace(/\/+$/, "");
    if (/\/v1$/i.test(path)) {
        return query ? `${path}?${query}` : path;
    }
    return query ? `${path}/v1?${query}` : `${path}/v1`;
}

export function extractTokenFromBaseUrl(url: string): string {
    const queryIndex = url.indexOf("?");
    if (queryIndex === -1) {
        return "";
    }
    const params = new URLSearchParams(url.slice(queryIndex + 1));
    return params.get("token") ?? "";
}

export function estimateInputTokens(input: string | HermesInputItem[]): number {
    return Math.ceil(inputText(input).length / CHARS_PER_TOKEN);
}

export function toTaskDto(row: Task): TaskDto {
    const payload = row.inputPayload as HermesResponseCreateParams;
    const error = row.lastError as unknown as TaskErrorInfo | null;
    const resultPayload = (row.resultPayload as unknown as TaskResultPayload | null) ?? null;
    return {
        id: row.id,
        status: row.status,
        model: payload.model,
        conversationId: row.conversationId,
        idempotencyKey: row.idempotencyKey,
        attempt: row.attempt,
        maxAttempts: row.maxAttempts,
        resultPayload,
        error: error ? { code: error.code, message: error.message } : null,
        stream: row.stream,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
    };
}

export interface CreateTaskResult {
    task: TaskDto;
    created: boolean;
}

export interface TasksServiceDeps {
    db?: PrismaClient;
    usage?: UsageService;
    audit?: AuditService;
    penalty?: PenaltyService;
}

export class TasksService {
    private readonly db: PrismaClient;

    constructor(
        private readonly bus: TaskEventBus,
        private readonly conversations: ConversationsService,
        private readonly deps: TasksServiceDeps = {},
    ) {
        this.db = deps.db ?? prisma;
    }

    async create(
        userId: string,
        input: CreateTaskInput,
        audit?: AuditSource,
    ): Promise<CreateTaskResult> {
        if (input.idempotencyKey) {
            const existing = await this.db.task.findUnique({
                where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
            });
            if (existing) {
                return { task: toTaskDto(existing), created: false };
            }
        }

        await this.deps.usage?.assertQuota(userId);

        const penaltyStatus = await this.deps.penalty?.status(userId);
        if (penaltyStatus?.blocked && penaltyStatus.remainingMs !== null) {
            const remainingMin = Math.ceil(penaltyStatus.remainingMs / 60_000);
            throw new AppError(
                errorCodes.ACCOUNT_TEMP_LIMITED,
                `Account temporarily limited: new tasks are blocked for ${remainingMin} more minute(s) after exceeding the input token limit.`,
                {
                    statusCode: 429,
                    details: {
                        code: "ACCOUNT_TEMP_LIMITED",
                        until: penaltyStatus.until,
                        remainingMs: penaltyStatus.remainingMs,
                    },
                },
            );
        }

        const estimatedInputTokens = estimateInputTokens(input.input);
        if (env.MAX_INPUT_TOKENS > 0 && estimatedInputTokens > env.MAX_INPUT_TOKENS) {
            throw new AppError(
                errorCodes.PAYLOAD_TOO_LARGE,
                `Input exceeds the maximum allowed size (estimated ${estimatedInputTokens} input tokens; limit ${env.MAX_INPUT_TOKENS})`,
                {
                    statusCode: 413,
                    details: { estimatedInputTokens, maxInputTokens: env.MAX_INPUT_TOKENS },
                },
            );
        }

        let conversationId: string | null = null;
        if (input.conversationId) {
            const conversation = await this.conversations.getOwned(userId, input.conversationId);
            conversationId = conversation.id;
        }

        const payload: HermesResponseCreateParams = {
            model: input.model,
            input: input.input,
            ...(input.instructions ? { instructions: input.instructions } : {}),
            ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
            ...(input.maxOutputTokens !== undefined
                ? { max_output_tokens: input.maxOutputTokens }
                : {}),
            ...(input.outputFile ? { outputFile: input.outputFile } : {}),
            ...(input.api_key || input.token || env.OLLAMA_API_KEY
                ? {
                      api_key:
                          input.api_key ||
                          input.token ||
                          extractTokenFromBaseUrl(input.base_url || input.endpoint || "") ||
                          env.OLLAMA_API_KEY,
                  }
                : {}),
            base_url: normalizeBaseUrl(input.base_url || input.endpoint || env.OLLAMA_BASE_URL),
        };

        try {
            const created = await this.db.$transaction(async (tx) => {
                const task = await tx.task.create({
                    data: {
                        userId,
                        conversationId,
                        status: "ENQUEUED",
                        inputPayload: payload as unknown as Prisma.InputJsonValue,
                        idempotencyKey: input.idempotencyKey ?? null,
                        // `maxAttempts` es legacy: se persiste pero sin efecto (sin reintento
                        // automático; al primer fallo la tarea queda FAILED).
                        maxAttempts: input.maxAttempts ?? 1,
                        stream: input.stream ?? false,
                    },
                });
                await this.deps.usage?.recordRequest(tx, userId, task.id, input.model);
                await this.deps.audit?.record(
                    auditEntry(userId, "task.created", audit, {
                        resourceType: "Task",
                        resourceId: task.id,
                        context: { model: input.model, conversationId },
                    }),
                    tx,
                );
                if (conversationId) {
                    const text = inputText(input.input);
                    if (text) {
                        await tx.message.create({
                            data: { conversationId, role: "USER", content: text },
                        });
                    }
                    await tx.conversation.update({
                        where: { id: conversationId },
                        data: { lastUsedAt: new Date() },
                    });
                }
                return task;
            });

            const dto = toTaskDto(created);
            this.bus.publish(created.id, { type: "task.queued", task: dto, timestamp: Date.now() });
            return { task: dto, created: true };
        } catch (error) {
            if (isPrismaError(error, "P2002") && input.idempotencyKey) {
                const existing = await this.db.task.findUnique({
                    where: {
                        userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey },
                    },
                });
                if (existing) {
                    return { task: toTaskDto(existing), created: false };
                }
            }
            throw error;
        }
    }

    async get(userId: string, taskId: string): Promise<TaskDto> {
        const task = await this.db.task.findFirst({ where: { id: taskId, userId } });
        if (!task) {
            throw AppError.notFound("Task not found");
        }
        return toTaskDto(task);
    }

    async list(userId: string): Promise<TaskDto[]> {
        const tasks = await this.db.task.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return tasks.map(toTaskDto);
    }

    async cancel(userId: string, taskId: string, audit?: AuditSource): Promise<void> {
        const task = await this.db.task.findFirst({ where: { id: taskId, userId } });
        if (!task) {
            throw AppError.notFound("Task not found");
        }
        if (isFinalStatus(task.status)) {
            throw AppError.conflict("Task has already finished");
        }
        const updated = await this.db.$transaction(async (tx) => {
            const result = await tx.task.update({
                where: { id: taskId },
                data: { status: "CANCELLED", cancelledAt: new Date() },
            });
            await this.deps.audit?.record(
                auditEntry(userId, "task.cancelled", audit, {
                    resourceType: "Task",
                    resourceId: taskId,
                }),
                tx,
            );
            return result;
        });
        this.bus.publish("task.cancel", { type: "task.cancel", taskId });
        this.bus.publish(taskId, { type: "task.cancelled", task: toTaskDto(updated) });
    }
}

export function isFinalStatus(status: Task["status"]): boolean {
    return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}
