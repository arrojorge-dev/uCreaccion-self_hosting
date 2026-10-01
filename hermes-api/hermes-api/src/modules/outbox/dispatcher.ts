import { exponentialBackoffMs } from "../../common/backoff.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import type { OutboxHandler } from "./types.js";

const CLAIM_LEASE_S = 60;
const MAX_BACKOFF_MS = 60_000;

export interface OutboxDispatcherLogger {
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
}

export interface OutboxDispatcherOptions {
    handlers: Record<string, OutboxHandler>;
    pollIntervalMs?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    logger?: OutboxDispatcherLogger;
    db?: PrismaClient;
}

interface OutboxRow {
    id: string;
    aggregateType: string;
    aggregateId: string;
    type: string;
    payload: unknown;
    status: string;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: Date | null;
    createdAt: Date;
    dispatchedAt: Date | null;
}

export class OutboxDispatcher {
    private readonly handlers: Record<string, OutboxHandler>;
    private readonly pollIntervalMs: number;
    private readonly maxAttempts: number;
    private readonly retryBaseMs: number;
    private readonly logger: OutboxDispatcherLogger;
    private readonly db: PrismaClient;
    private timer: NodeJS.Timeout | null = null;
    private working = false;
    private stopped = false;

    constructor(options: OutboxDispatcherOptions) {
        this.handlers = options.handlers;
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.maxAttempts = options.maxAttempts ?? 5;
        this.retryBaseMs = options.retryBaseMs ?? 200;
        this.logger = options.logger ?? {
            error: () => undefined,
            warn: () => undefined,
        };
        this.db = options.db ?? prisma;
    }

    start(): void {
        if (this.timer) {
            return;
        }
        this.stopped = false;
        this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
        void this.tick();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async tick(): Promise<void> {
        if (this.working || this.stopped) {
            return;
        }
        this.working = true;
        try {
            await this.drain();
        } catch (error) {
            this.logger.error({ err: error }, "outbox dispatcher tick failed");
        } finally {
            this.working = false;
        }
    }

    private async drain(): Promise<void> {
        for (;;) {
            const claimed = await this.claimNext();
            if (!claimed) {
                return;
            }
            await this.process(claimed);
        }
    }

    private async claimNext(): Promise<OutboxRow | null> {
        const rows = await this.db.$queryRaw<OutboxRow[]>`
			UPDATE "OutboxMessage"
			SET "attempts" = "attempts" + 1,
			    "nextAttemptAt" = NOW() + make_interval(secs => ${CLAIM_LEASE_S})
			WHERE id IN (
				SELECT id
				FROM "OutboxMessage"
				WHERE "status" = 'PENDING'
				  AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
				ORDER BY "createdAt" ASC
				LIMIT 1
				FOR UPDATE SKIP LOCKED
			)
			RETURNING *`;
        return rows[0] ?? null;
    }

    private async process(claimed: OutboxRow): Promise<void> {
        const handler = this.handlers[claimed.type];
        if (!handler) {
            await this.db.outboxMessage.update({
                where: { id: claimed.id },
                data: { status: "DEAD", lastError: `no handler for outbox type: ${claimed.type}` },
            });
            this.logger.error(
                { outboxId: claimed.id, type: claimed.type },
                "outbox message dead: no handler",
            );
            return;
        }
        try {
            await handler({
                id: claimed.id,
                aggregateType: claimed.aggregateType,
                aggregateId: claimed.aggregateId,
                type: claimed.type,
                payload: claimed.payload,
            });
            await this.db.outboxMessage.update({
                where: { id: claimed.id },
                data: { status: "DISPATCHED", dispatchedAt: new Date() },
            });
        } catch (error) {
            const info = error instanceof Error ? error.message : String(error);
            if (claimed.attempts >= this.maxAttempts) {
                await this.db.outboxMessage.update({
                    where: { id: claimed.id },
                    data: { status: "DEAD", lastError: info },
                });
                this.logger.error(
                    { outboxId: claimed.id, attempts: claimed.attempts, error: info },
                    "outbox message is dead",
                );
            } else {
                const delay = exponentialBackoffMs(
                    claimed.attempts,
                    this.retryBaseMs,
                    MAX_BACKOFF_MS,
                );
                await this.db.outboxMessage.update({
                    where: { id: claimed.id },
                    data: {
                        status: "PENDING",
                        lastError: info,
                        nextAttemptAt: new Date(Date.now() + delay),
                    },
                });
                this.logger.warn(
                    { outboxId: claimed.id, attempts: claimed.attempts, error: info },
                    "outbox message will be retried",
                );
            }
        }
    }
}
