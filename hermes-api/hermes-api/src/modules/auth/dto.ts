import { z } from "zod";
import { publicUserSchema } from "../users/dto.js";

export const NICKNAME_REGEX = /^[a-zA-Z0-9@._-]{3,30}$/;

const nicknameSchema = z
    .string()
    .min(3)
    .max(30)
    .regex(NICKNAME_REGEX, "must be 3-30 chars: letters, digits, @ . _ - (no spaces)");

export const registerSchema = z.object({
    nickname: nicknameSchema,
    password: z.string().min(8).max(72),
    name: z.string().min(1).max(120).optional(),
});

export const loginSchema = z.object({
    nickname: nicknameSchema,
    password: z.string().min(1),
});

export const refreshSchema = z.object({
    refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
    refreshToken: z.string().min(1),
});

export const tokenPairSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number(),
    tokenType: z.literal("Bearer"),
});

export const authResultSchema = z.object({
    user: publicUserSchema,
    tokens: tokenPairSchema,
});
