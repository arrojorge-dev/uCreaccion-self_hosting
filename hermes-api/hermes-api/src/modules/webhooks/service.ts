import { AppError } from "../../common/errors/app-error.js";
import type {
    Prisma,
    PrismaClient,
    Webhook,
    WebhookDelivery,
} from "../../generated/prisma/client.js";
import { randomToken } from "../../lib/crypto.js";
import { prisma } from "../../lib/db.js";
import { type AuditService, type AuditSource, auditEntry } from "../audit/index.js";
import type {
    CreatedWebhook,
    CreateWebhookInput,
    UpdateWebhookInput,
    WebhookDeliveryDto,
    WebhookDto,
} from "./types.js";

function toWebhookDto(webhook: Webhook): WebhookDto {
    return {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
    };
}

function toDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
    return {
        id: delivery.id,
        webhookId: delivery.webhookId,
        outboxMessageId: delivery.outboxMessageId,
        eventType: delivery.eventType,
        payload: delivery.payload,
        status: delivery.status,
        attempts: delivery.attempts,
        responseStatus: delivery.responseStatus,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt.toISOString(),
        deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    };
}

export class WebhooksService {
    constructor(
        private readonly db: PrismaClient = prisma,
        private readonly audit: AuditService | null = null,
    ) {}

    async create(
        userId: string,
        input: CreateWebhookInput,
        audit?: AuditSource,
    ): Promise<CreatedWebhook> {
        const trimmed = input.secret?.trim() ?? "";
        const secret = trimmed.length >= 16 ? trimmed : randomToken(32);
        const created = await this.db.webhook.create({
            data: { userId, url: input.url.trim(), secret, events: input.events },
        });
        await this.audit?.record(
            auditEntry(userId, "webhook.created", audit, {
                resourceType: "Webhook",
                resourceId: created.id,
                context: { url: created.url, events: created.events },
            }),
        );
        return { ...toWebhookDto(created), secret };
    }

    async list(userId: string): Promise<WebhookDto[]> {
        const webhooks = await this.db.webhook.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });
        return webhooks.map(toWebhookDto);
    }

    async get(userId: string, id: string): Promise<WebhookDto> {
        const webhook = await this.db.webhook.findFirst({ where: { id, userId } });
        if (!webhook) {
            throw AppError.notFound("Webhook not found");
        }
        return toWebhookDto(webhook);
    }

    async update(
        userId: string,
        id: string,
        input: UpdateWebhookInput,
        audit?: AuditSource,
    ): Promise<WebhookDto> {
        const existing = await this.get(userId, id);
        const updated = await this.db.webhook.update({
            where: { id: existing.id },
            data: {
                ...(input.url !== undefined ? { url: input.url.trim() } : {}),
                ...(input.events !== undefined ? { events: input.events } : {}),
                ...(input.active !== undefined ? { active: input.active } : {}),
            },
        });
        await this.audit?.record(
            auditEntry(userId, "webhook.updated", audit, {
                resourceType: "Webhook",
                resourceId: updated.id,
                context: { url: updated.url, events: updated.events, active: updated.active },
            }),
        );
        return toWebhookDto(updated);
    }

    async delete(userId: string, id: string, audit?: AuditSource): Promise<void> {
        const existing = await this.get(userId, id);
        await this.db.webhook.delete({ where: { id: existing.id } });
        await this.audit?.record(
            auditEntry(userId, "webhook.deleted", audit, {
                resourceType: "Webhook",
                resourceId: existing.id,
                context: { url: existing.url },
            }),
        );
    }

    async listActiveByUserAndEvent(userId: string, event: string): Promise<Array<{ id: string }>> {
        const webhooks = await this.db.webhook.findMany({
            where: { userId, active: true, events: { has: event } },
            select: { id: true },
        });
        return webhooks;
    }

    async createDelivery(input: {
        webhookId: string;
        outboxMessageId: string | null;
        eventType: string;
        payload: unknown;
    }): Promise<WebhookDeliveryDto> {
        const delivery = await this.db.webhookDelivery.create({
            data: {
                webhookId: input.webhookId,
                outboxMessageId: input.outboxMessageId,
                eventType: input.eventType,
                payload: input.payload as Prisma.InputJsonValue,
            },
        });
        return toDeliveryDto(delivery);
    }

    async listDeliveries(
        userId: string,
        webhookId: string,
        limit = 50,
    ): Promise<WebhookDeliveryDto[]> {
        await this.get(userId, webhookId);
        const deliveries = await this.db.webhookDelivery.findMany({
            where: { webhookId },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        return deliveries.map(toDeliveryDto);
    }

    async redeliverDelivery(userId: string, deliveryId: string): Promise<void> {
        const delivery = await this.db.webhookDelivery.findUnique({
            where: { id: deliveryId },
            include: { webhook: true },
        });
        if (!delivery || delivery.webhook.userId !== userId) {
            throw AppError.notFound("Delivery not found");
        }
        await this.db.webhookDelivery.update({
            where: { id: deliveryId },
            data: {
                status: "PENDING",
                attempts: 0,
                lastError: null,
                nextAttemptAt: new Date(),
                deliveredAt: null,
            },
        });
    }
}
