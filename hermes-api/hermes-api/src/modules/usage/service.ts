import { AppError } from "../../common/errors/app-error.js";
import { errorCodes } from "../../common/errors/codes.js";
import {
    defaultQuotaConfig,
    evaluateQuota,
    QUOTA_WINDOW_MS,
    type QuotaConfig,
    type UsageSnapshot,
} from "../../common/quotas.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";

export type UsageDb = PrismaClient | Prisma.TransactionClient;

export class UsageService {
    constructor(
        private readonly db: PrismaClient = prisma,
        private readonly quotas: QuotaConfig = defaultQuotaConfig,
        private readonly windowMs: number = QUOTA_WINDOW_MS,
    ) {}

    async getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
        const since = new Date(Date.now() - this.windowMs);
        const [requests, tokens] = await Promise.all([
            this.db.usageRecord.count({
                where: { userId, kind: "REQUESTS", createdAt: { gte: since } },
            }),
            this.db.usageRecord.aggregate({
                where: { userId, kind: "TOKENS", createdAt: { gte: since } },
                _sum: { amount: true },
            }),
        ]);
        return { requests, tokens: tokens._sum.amount ?? 0 };
    }

    async assertQuota(userId: string): Promise<void> {
        const user = await this.db.user.findUnique({
            where: { id: userId },
            select: { plan: true },
        });
        if (!user) {
            throw AppError.notFound("User not found");
        }
        const usage = await this.getUsageSnapshot(userId);
        const evaluation = evaluateQuota(usage, this.quotas[user.plan]);
        if (!evaluation.allowed) {
            throw new AppError(
                errorCodes.QUOTA_EXCEEDED,
                `Plan ${user.plan} quota exceeded (${evaluation.reason})`,
                {
                    statusCode: 429,
                    details: { plan: user.plan, reason: evaluation.reason, usage },
                },
            );
        }
    }

    async recordRequest(db: UsageDb, userId: string, taskId: string, model: string): Promise<void> {
        await db.usageRecord.create({
            data: { userId, taskId, kind: "REQUESTS", amount: 1, model },
        });
    }

    async recordTokens(
        db: UsageDb,
        input: {
            userId: string;
            taskId: string;
            model?: string | null;
            tokensIn?: number | null;
            tokensOut?: number | null;
        },
    ): Promise<void> {
        const amount = (input.tokensIn ?? 0) + (input.tokensOut ?? 0);
        if (amount <= 0) {
            return;
        }
        await db.usageRecord.create({
            data: {
                userId: input.userId,
                taskId: input.taskId,
                kind: "TOKENS",
                amount,
                tokensIn: input.tokensIn,
                tokensOut: input.tokensOut,
                model: input.model ?? null,
            } as Prisma.UsageRecordUncheckedCreateInput,
        });
    }
}
