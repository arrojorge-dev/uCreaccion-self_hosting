import { exponentialBackoffMs } from "../../common/backoff.js";
import type { PrismaClient, WebhookDelivery } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { signWebhookPayload } from "../../lib/hmac.js";
import { createHttpClient, type HttpClient } from "../../lib/http.js";

const CLAIM_LEASE_S = 60;
const MAX_BACKOFF_MS = 30_000;

export interface WebhookSenderLogger {
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
}

export interface WebhookSenderOptions {
    pollIntervalMs?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    timeoutMs?: number;
    logger?: WebhookSenderLogger;
    db?: PrismaClient;
    http?: HttpClient;
}

export class WebhookSender {
    private readonly pollIntervalMs: number;
    private readonly maxAttempts: number;
    private readonly retryBaseMs: number;
    private readonly timeoutMs: number;
    private readonly logger: WebhookSenderLogger;
    private readonly db: PrismaClient;
    private readonly http: HttpClient;
    private timer: NodeJS.Timeout | null = null;
    private working = false;
    private stopped = false;

    constructor(options: WebhookSenderOptions) {
        this.pollIntervalMs = options.pollIntervalMs ?? 1000;
        this.maxAttempts = options.maxAttempts ?? 5;
        this.retryBaseMs = options.retryBaseMs ?? 200;
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.logger = options.logger ?? {
            error: () => undefined,
            warn: () => undefined,
        };
        this.db = options.db ?? prisma;
        this.http =
            options.http ??
            createHttpClient({
                baseUrl: "http://webhook-sender.invalid",
                timeoutMs: this.timeoutMs,
                retries: 0,
            });
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
            this.logger.error({ err: error }, "webhook sender tick failed");
        } finally {
            this.working = false;
        }
    }

    private async drain(): Promise<void> {
        for (;;) {
            const delivery = await this.claimNext();
            if (!delivery) {
                return;
            }
            await this.deliver(delivery);
        }
    }

    private async claimNext(): Promise<WebhookDelivery | null> {
        const rows = await this.db.$queryRaw<WebhookDelivery[]>`
			UPDATE "WebhookDelivery"
			SET "attempts" = "attempts" + 1,
			    "nextAttemptAt" = NOW() + make_interval(secs => ${CLAIM_LEASE_S})
			WHERE id IN (
				SELECT id
				FROM "WebhookDelivery"
				WHERE "status" = 'PENDING'
				  AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
				ORDER BY "createdAt" ASC
				LIMIT 1
				FOR UPDATE SKIP LOCKED
			)
			RETURNING *`;
        return rows[0] ?? null;
    }

    private async deliver(claimed: WebhookDelivery): Promise<void> {
        const full = await this.db.webhookDelivery.findUnique({
            where: { id: claimed.id },
            include: { webhook: true },
        });
        if (!full) {
            return;
        }
        const body = JSON.stringify(full.payload);
        const signature = signWebhookPayload(full.webhook.secret, body);
        try {
            const result = await this.http.postRaw(full.webhook.url, full.payload, {
                retries: 0,
                headers: {
                    "x-hermes-event": full.eventType,
                    "x-hermes-event-id": full.outboxMessageId ?? full.id,
                    "x-hermes-delivery-id": full.id,
                    "x-hermes-signature": signature,
                    "x-hermes-timestamp": String(Math.floor(Date.now() / 1000)),
                },
            });
            await this.db.webhookDelivery.update({
                where: { id: full.id },
                data: {
                    status: "DELIVERED",
                    responseStatus: result.status,
                    deliveredAt: new Date(),
                },
            });
        } catch (error) {
            const info = error instanceof Error ? error.message : String(error);
            if (full.attempts >= this.maxAttempts) {
                await this.db.webhookDelivery.update({
                    where: { id: full.id },
                    data: { status: "DEAD", lastError: info },
                });
                this.logger.error(
                    { deliveryId: full.id, attempts: full.attempts, error: info },
                    "webhook delivery is dead",
                );
            } else {
                const delay = exponentialBackoffMs(full.attempts, this.retryBaseMs, MAX_BACKOFF_MS);
                await this.db.webhookDelivery.update({
                    where: { id: full.id },
                    data: {
                        status: "PENDING",
                        lastError: info,
                        nextAttemptAt: new Date(Date.now() + delay),
                    },
                });
                this.logger.warn(
                    { deliveryId: full.id, attempts: full.attempts, error: info },
                    "webhook delivery will be retried",
                );
            }
        }
    }
}
