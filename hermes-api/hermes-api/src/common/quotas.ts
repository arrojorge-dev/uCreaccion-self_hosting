import type { Plan } from "../generated/prisma/client.js";

export interface PlanQuota {
    requestsPerWindow: number | null;
    tokensPerWindow: number | null;
}

export type QuotaConfig = Record<Plan, PlanQuota>;

export const defaultQuotaConfig: QuotaConfig = {
    FREE: { requestsPerWindow: 50, tokensPerWindow: 500_000 },
    PRO: { requestsPerWindow: 5_000, tokensPerWindow: 5_000_000 },
};

export const QUOTA_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface UsageSnapshot {
    requests: number;
    tokens: number;
}

export interface QuotaEvaluation {
    allowed: boolean;
    reason: "requests" | "tokens" | null;
}

export function evaluateQuota(usage: UsageSnapshot, quota: PlanQuota): QuotaEvaluation {
    if (quota.requestsPerWindow !== null && usage.requests >= quota.requestsPerWindow) {
        return { allowed: false, reason: "requests" };
    }
    if (quota.tokensPerWindow !== null && usage.tokens >= quota.tokensPerWindow) {
        return { allowed: false, reason: "tokens" };
    }
    return { allowed: true, reason: null };
}
