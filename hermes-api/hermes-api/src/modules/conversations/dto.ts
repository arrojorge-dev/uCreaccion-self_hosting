import { z } from "zod";

export const conversationIdParamsSchema = z.object({
    id: z.string().uuid(),
});

export const createConversationSchema = z.object({
    projectId: z.string().uuid().optional(),
    title: z.string().min(1).max(200).optional(),
});

export const conversationDtoSchema = z.object({
    id: z.string(),
    projectId: z.string().nullable(),
    title: z.string().nullable(),
    hermesSessionId: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string(),
});

export const messageDtoSchema = z.object({
    id: z.string(),
    conversationId: z.string(),
    role: z.string(),
    content: z.string(),
    createdAt: z.string(),
});

export const conversationDetailSchema = z.object({
    conversation: conversationDtoSchema,
    messages: z.array(messageDtoSchema),
});
