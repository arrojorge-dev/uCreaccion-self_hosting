import { getRedisClient } from "../../lib/redis.js";

const STREAK_KEY = (userId: string): string => `penalty:${userId}:streak`;
const UNTIL_KEY = (userId: string): string => `penalty:${userId}:until`;
const STREAK_TTL_SECONDS = 24 * 60 * 60;
const WAITS_MINUTES = [10, 20, 40, 24 * 60];

export interface PenaltyStatus {
    blocked: boolean;
    until: number | null;
    remainingMs: number | null;
}

export class PenaltyService {
    async recordBudgetExhausted(userId: string): Promise<void> {
        const redis = getRedisClient();
        if (!redis) {
            return;
        }
        const streak = await redis.incr(STREAK_KEY(userId));
        await redis.expire(STREAK_KEY(userId), STREAK_TTL_SECONDS);
        const index = Math.min(streak, WAITS_MINUTES.length) - 1;
        const waitMs = (WAITS_MINUTES[index] ?? WAITS_MINUTES[0] ?? 10) * 60_000;
        const until = Date.now() + waitMs;
        await redis.set(UNTIL_KEY(userId), String(until), "PX", waitMs);
    }

    async resetStreak(userId: string): Promise<void> {
        const redis = getRedisClient();
        if (!redis) {
            return;
        }
        await redis.del(STREAK_KEY(userId));
    }

    async blockedUntil(userId: string): Promise<number | null> {
        const redis = getRedisClient();
        if (!redis) {
            return null;
        }
        const value = await redis.get(UNTIL_KEY(userId));
        if (!value) {
            return null;
        }
        const until = Number(value);
        return Number.isFinite(until) && until > Date.now() ? until : null;
    }

    async status(userId: string): Promise<PenaltyStatus> {
        const until = await this.blockedUntil(userId);
        if (until === null) {
            return { blocked: false, until: null, remainingMs: null };
        }
        return { blocked: true, until, remainingMs: until - Date.now() };
    }
}
