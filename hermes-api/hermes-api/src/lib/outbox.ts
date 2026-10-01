import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export interface OutboxEntry {
    aggregateType: string;
    aggregateId: string;
    type: string;
    payload: unknown;
}

export type OutboxDb = PrismaClient | Prisma.TransactionClient;

export function outboxCreate(db: OutboxDb, entry: OutboxEntry) {
    return db.outboxMessage.create({
        data: {
            aggregateType: entry.aggregateType,
            aggregateId: entry.aggregateId,
            type: entry.type,
            payload: entry.payload as Prisma.InputJsonValue,
        },
    });
}
