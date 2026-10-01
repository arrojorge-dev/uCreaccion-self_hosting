import { z } from "zod";

export const createApiKeySchema = z.object({
    name: z.string().min(1).max(80),
    scopes: z.array(z.string().min(1).max(60)).max(20).default([]),
});

export const createdApiKeySchema = z.object({
    id: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    key: z.string(),
});

export const apiKeySummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    scopes: z.array(z.string()),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
});
