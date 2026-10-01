import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import type { AuditEntry } from "./types.js";

export type AuditDb = PrismaClient | Prisma.TransactionClient;

export class AuditService {
    constructor(private readonly db: PrismaClient = prisma) {}

    async record(entry: AuditEntry, db: AuditDb = this.db): Promise<void> {
        await db.auditLog.create({
            data: {
                userId: entry.userId ?? null,
                actorType: entry.actorType,
                actorId: entry.actorId ?? null,
                action: entry.action,
                resourceType: entry.resourceType ?? null,
                resourceId: entry.resourceId ?? null,
                context:
                    entry.context === undefined
                        ? undefined
                        : (entry.context as Prisma.InputJsonValue),
                ip: entry.ip ?? null,
                requestId: entry.requestId ?? null,
            },
        });
    }
}
