import type { TaskStatus } from "../../generated/prisma/client.js";
import type { HermesInputItem, HermesUsage } from "../hermes/types.js";

export type { TaskStatus };

export interface CreateTaskInput {
    model: string;
    input: string | HermesInputItem[];
    conversationId?: string;
    instructions?: string;
    temperature?: number;
    maxOutputTokens?: number;
    maxAttempts?: number;
    idempotencyKey?: string;
    stream?: boolean;
    outputFile?: string;
    token?: string;
    endpoint?: string;
    api_key?: string;
    base_url?: string;
}

export interface TaskResultFile {
    name: string;
    mimeType: string;
    size: number;
    dataBase64: string;
}

export interface TaskResultPayload {
    text?: string;
    usage?: HermesUsage;
    files?: TaskResultFile[];
}

export interface TaskErrorInfo {
    code: string;
    message: string;
}

export interface TaskDto {
    id: string;
    status: TaskStatus;
    model: string;
    conversationId: string | null;
    idempotencyKey: string | null;
    attempt: number;
    maxAttempts: number;
    resultPayload: TaskResultPayload | null;
    error: TaskErrorInfo | null;
    stream: boolean;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
}

export type TaskStreamEvent =
    | { type: "task.queued"; task: TaskDto; timestamp: number }
    | { type: "task.running"; task: TaskDto }
    | { type: "task.output.delta"; taskId: string; delta: string }
    | { type: "task.succeeded"; task: TaskDto }
    | { type: "task.failed"; task: TaskDto }
    | { type: "task.cancelled"; task: TaskDto }
    | { type: "task.cancel"; taskId: string };

export function isFinalEvent(event: TaskStreamEvent): boolean {
    return (
        event.type === "task.succeeded" ||
        event.type === "task.failed" ||
        event.type === "task.cancelled"
    );
}
