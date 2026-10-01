import { z } from "zod";
import { WEBHOOK_EVENTS } from "./types.js";

const httpUrlSchema = z
    .string()
    .url("must be a valid URL")
    .refine((value) => /^https?:\/\//i.test(value), "must use http(s)");

export const createWebhookSchema = z.object({
    url: httpUrlSchema,
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "at least one event is required"),
    secret: z.string().min(16).max(256).optional(),
});

export const updateWebhookSchema = z.object({
    url: httpUrlSchema.optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
    active: z.boolean().optional(),
});

export const webhookIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const deliveryIdParamsSchema = z.object({
    id: z.string().uuid(),
    deliveryId: z.string().uuid(),
});

export const webhookDtoSchema = z.object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    active: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const createdWebhookSchema = webhookDtoSchema.extend({
    secret: z.string(),
});

export const webhookDeliveryDtoSchema = z.object({
    id: z.string(),
    webhookId: z.string(),
    outboxMessageId: z.string().nullable(),
    eventType: z.string(),
    payload: z.unknown(),
    status: z.enum(["PENDING", "DELIVERED", "FAILED", "DEAD"]),
    attempts: z.number(),
    responseStatus: z.number().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.string(),
    deliveredAt: z.string().nullable(),
});
