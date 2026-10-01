import type { WebhookDeliveryStatus } from "../../generated/prisma/client.js";

export const WEBHOOK_EVENTS = ["task.completed"] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface CreateWebhookInput {
    url: string;
    events: string[];
    secret?: string;
}

export interface UpdateWebhookInput {
    url?: string;
    events?: string[];
    active?: boolean;
}

export interface WebhookDto {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreatedWebhook extends WebhookDto {
    secret: string;
}

export interface WebhookDeliveryDto {
    id: string;
    webhookId: string;
    outboxMessageId: string | null;
    eventType: string;
    payload: unknown;
    status: WebhookDeliveryStatus;
    attempts: number;
    responseStatus: number | null;
    lastError: string | null;
    createdAt: string;
    deliveredAt: string | null;
}
