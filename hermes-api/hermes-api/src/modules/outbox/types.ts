import type { OutboxStatus } from "../../generated/prisma/client.js";

export interface OutboxMessageDto {
    id: string;
    aggregateType: string;
    aggregateId: string;
    type: string;
    payload: unknown;
    status: OutboxStatus;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: string | null;
    createdAt: string;
    dispatchedAt: string | null;
}

export interface OutboxHandlerContext {
    id: string;
    aggregateType: string;
    aggregateId: string;
    type: string;
    payload: unknown;
}

export type OutboxHandler = (message: OutboxHandlerContext) => Promise<void>;
