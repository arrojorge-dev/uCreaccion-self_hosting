import { AppError } from "../../common/errors/app-error.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { randomToken, sha256Hex } from "../../lib/crypto.js";
import { isPrismaError, prisma } from "../../lib/db.js";
import { type AuditService, type AuditSource, auditEntry } from "../audit/index.js";
import type { ActiveApiKey, ApiKeySummary, CreatedApiKey } from "./types.js";

export class ApiKeysService {
    constructor(
        private readonly db: PrismaClient = prisma,
        private readonly audit: AuditService | null = null,
    ) {}

    async create(
        userId: string,
        name: string,
        scopes: string[],
        audit?: AuditSource,
    ): Promise<CreatedApiKey> {
        const secret = randomToken(32);
        const prefix = randomToken(8).slice(0, 8);
        const key = `hk_${prefix}.${secret}`;
        try {
            const created = await this.db.apiKey.create({
                data: { userId, name: name.trim(), keyHash: sha256Hex(key), prefix, scopes },
            });
            await this.audit?.record(
                auditEntry(userId, "apikey.created", audit, {
                    resourceType: "ApiKey",
                    resourceId: created.id,
                    context: { name: created.name, scopes: created.scopes, prefix: created.prefix },
                }),
            );
            return { id: created.id, name: created.name, scopes: created.scopes, key };
        } catch (error) {
            if (isPrismaError(error, "P2002")) {
                throw AppError.conflict("API key collision, please retry");
            }
            throw error;
        }
    }

    async list(userId: string): Promise<ApiKeySummary[]> {
        const keys = await this.db.apiKey.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });
        return keys.map((key) => ({
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            scopes: key.scopes,
            createdAt: key.createdAt.toISOString(),
            lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
            expiresAt: key.expiresAt?.toISOString() ?? null,
            revokedAt: key.revokedAt?.toISOString() ?? null,
        }));
    }

    async revoke(userId: string, keyId: string, audit?: AuditSource): Promise<void> {
        const result = await this.db.apiKey.updateMany({
            where: { id: keyId, userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        if (result.count === 0) {
            throw AppError.notFound("API key not found");
        }
        await this.audit?.record(
            auditEntry(userId, "apikey.revoked", audit, {
                resourceType: "ApiKey",
                resourceId: keyId,
            }),
        );
    }

    async findActiveByKey(fullKey: string): Promise<ActiveApiKey> {
        const key = await this.db.apiKey.findUnique({ where: { keyHash: sha256Hex(fullKey) } });
        if (!key || key.revokedAt !== null) {
            throw AppError.unauthorized("Invalid API key");
        }
        if (key.expiresAt !== null && key.expiresAt.getTime() < Date.now()) {
            throw AppError.unauthorized("API key has expired");
        }
        return { id: key.id, userId: key.userId, scopes: key.scopes };
    }
}
