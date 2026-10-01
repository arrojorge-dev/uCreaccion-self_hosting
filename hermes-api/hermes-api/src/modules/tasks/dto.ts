import { z } from "zod";

export const taskIdParamsSchema = z.object({
    id: z.string().uuid(),
});

const inputItemSchema = z.object({ type: z.string(), text: z.string().optional() }).passthrough();

export const createTaskSchema = z.object({
    model: z.string().min(1).max(200),
    input: z.union([z.string(), z.array(inputItemSchema)]),
    conversationId: z.string().uuid().optional(),
    instructions: z.string().max(8000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_output_tokens: z.number().int().positive().max(100_000).optional(),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    stream: z.boolean().optional(),
    outputFile: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[^/\\]+$/, "must be a file name without path separators")
        .optional(),
    token: z.string().max(500).optional(),
    endpoint: z.string().url().optional(),
    api_key: z.string().max(500).optional(),
    base_url: z.string().url().optional(),
});

export const streamQuerySchema = z.object({
    stream: z.enum(["true", "false"]).optional(),
});

export const taskResultFileSchema = z.object({
    name: z.string(),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
    dataBase64: z.string(),
});

export const taskDtoSchema = z.object({
    id: z.string(),
    status: z.enum(["PENDING", "ENQUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
    model: z.string(),
    conversationId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
    attempt: z.number(),
    maxAttempts: z.number(),
    resultPayload: z
        .object({
            text: z.string().optional(),
            usage: z.unknown().optional(),
            files: z.array(taskResultFileSchema).optional(),
        })
        .nullable(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    stream: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
});
