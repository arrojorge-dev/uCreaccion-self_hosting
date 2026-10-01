import type { ActorType } from "../../generated/prisma/client.js";

export interface AuditEntry {
    userId?: string | null;
    actorType: ActorType;
    actorId?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    context?: unknown;
    ip?: string | null;
    requestId?: string | null;
}

export interface AuditSource {
    actorType: ActorType;
    actorId: string | null;
    ip: string | null;
    requestId: string;
}

export function auditEntry(
    userId: string,
    action: string,
    source: AuditSource | undefined,
    extra: Partial<
        Omit<AuditEntry, "userId" | "action" | "actorType" | "actorId" | "ip" | "requestId">
    > = {},
): AuditEntry {
    return {
        userId,
        action,
        ...extra,
        actorType: source?.actorType ?? "SYSTEM",
        actorId: source?.actorId ?? null,
        ip: source?.ip ?? null,
        requestId: source?.requestId ?? null,
    };
}
