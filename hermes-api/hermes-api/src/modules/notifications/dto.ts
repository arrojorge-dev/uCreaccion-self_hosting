import { z } from "zod";

export const notificationDtoSchema = z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    payload: z.unknown().nullable(),
    read: z.boolean(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
});

export const unreadCountSchema = z.object({
    unread: z.number().int().nonnegative(),
});

export const notificationIdParamsSchema = z.object({
    id: z.string().uuid(),
});
