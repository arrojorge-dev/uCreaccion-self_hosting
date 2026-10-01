import type { OutboxMessage, PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { type OutboxEntry, outboxCreate } from "../../lib/outbox.js";
import type { OutboxMessageDto } from "./types.js";

function toOutboxDto(row: OutboxMessage): OutboxMessageDto {
    return {
        id: row.id,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        type: row.type,
        payload: row.payload,
        status: row.status,
        attempts: row.attempts,
        lastError: row.lastError,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    };
}

export class OutboxService {
    constructor(private readonly db: PrismaClient = prisma) {}

    async enqueue(entry: OutboxEntry): Promise<OutboxMessageDto> {
        const row = await outboxCreate(this.db, entry);
        return toOutboxDto(row);
    }

    async list(
        status: OutboxMessage["status"] | undefined,
        limit = 50,
    ): Promise<OutboxMessageDto[]> {
        const rows = await this.db.outboxMessage.findMany({
            where: status ? { status } : undefined,
            orderBy: { createdAt: "asc" },
            take: limit,
        });
        return rows.map(toOutboxDto);
    }

    async redeliver(id: string): Promise<OutboxMessageDto | null> {
        const row = await this.db.outboxMessage.findUnique({ where: { id } });
        if (row?.status !== "DEAD") {
            return null;
        }
        const updated = await this.db.outboxMessage.update({
            where: { id },
            data: {
                status: "PENDING",
                attempts: 0,
                lastError: null,
                nextAttemptAt: new Date(),
                dispatchedAt: null,
            },
        });
        return toOutboxDto(updated);
    }

    async redeliverDead(): Promise<number> {
        const result = await this.db.outboxMessage.updateMany({
            where: { status: "DEAD" },
            data: {
                status: "PENDING",
                attempts: 0,
                lastError: null,
                nextAttemptAt: new Date(),
                dispatchedAt: null,
            },
        });
        return result.count;
    }
}
