import { z } from "zod";

export const publicUserSchema = z.object({
    id: z.string(),
    nickname: z.string(),
    name: z.string().nullable(),
    plan: z.string(),
    createdAt: z.string(),
});

export const updateProfileSchema = z.object({
    name: z.string().min(1).max(120),
});
