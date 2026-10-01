import { z } from "zod";

export const deviceTokenSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "device token must be 64 hex characters");

export const registerDeviceBodySchema = z.object({
    token: deviceTokenSchema,
    platform: z.literal("ios").optional(),
});

export const deviceTokenParamsSchema = z.object({
    token: deviceTokenSchema,
});

export const deviceDtoSchema = z.object({
    id: z.string(),
    token: z.string(),
    platform: z.string(),
    env: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type DeviceDto = z.infer<typeof deviceDtoSchema>;
