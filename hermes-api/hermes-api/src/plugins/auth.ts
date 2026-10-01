import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";
import { hashPassword } from "../lib/crypto.js";
import { prisma } from "../lib/db.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { ApiKeysService } from "../modules/apikeys/service.js";
import type { AuditSource } from "../modules/audit/types.js";
import type { AuthenticatedUser } from "../modules/auth/types.js";

export interface ParsedAuth {
    type: "bearer" | "apikey";
    token: string;
}

declare module "fastify" {
    interface FastifyRequest {
        auth?: AuthenticatedUser;
        llmToken?: string;
    }
    interface FastifyInstance {
        requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        requireScope: (
            ...scopes: string[]
        ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

export function parseAuthHeader(headers: {
    authorization?: string | string[] | undefined;
    "x-api-key"?: string | string[] | undefined;
}): ParsedAuth | undefined {
    const authorization = headers.authorization;
    if (typeof authorization === "string") {
        const parts = authorization.split(" ");
        if (parts[0]?.toLowerCase() === "bearer" && parts[1]) {
            return { type: "bearer", token: parts[1] };
        }
    }
    const apiKey = headers["x-api-key"];
    if (typeof apiKey === "string" && apiKey.length > 0) {
        return { type: "apikey", token: apiKey };
    }
    return undefined;
}

export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser {
    if (!request.auth) {
        throw AppError.unauthorized();
    }
    return request.auth;
}

export function auditSourceFrom(request: FastifyRequest): AuditSource {
    const auth = request.auth;
    const actorType = auth?.type === "apiKey" ? "API_KEY" : auth ? "USER" : "SYSTEM";
    const actorId =
        auth?.type === "apiKey" ? (auth.apiKeyId ?? null) : auth ? (auth.userId ?? null) : null;
    return {
        actorType,
        actorId,
        ip: request.ip ?? null,
        requestId: request.id,
    };
}

async function ensureLocalUser(): Promise<AuthenticatedUser> {
    const nickname = env.LOCAL_USER_NICKNAME.trim().toLowerCase();
    const passwordHash = await hashPassword(env.LOCAL_USER_PASSWORD);
    const user = await prisma.user.upsert({
        where: { nickname },
        update: { passwordHash },
        create: { nickname, passwordHash, name: "Local user" },
        select: { id: true, nickname: true },
    });
    return { type: "user", userId: user.id, nickname: user.nickname, scopes: [] };
}

export function createAuthPlugin(options: {
    apiKeysService: ApiKeysService;
    resolveLocalUser?: () => Promise<AuthenticatedUser>;
}) {
    return fp(async (app) => {
        const resolveLocalUser = options.resolveLocalUser ?? ensureLocalUser;
        let localUser: Promise<AuthenticatedUser> | undefined;

        app.addHook("onRequest", async (request) => {
            const parsed = parseAuthHeader(request.headers);
            if (parsed) {
                try {
                    if (parsed.type === "bearer") {
                        const payload = await verifyAccessToken(parsed.token);
                        request.auth = {
                            type: "user",
                            userId: payload.sub,
                            nickname: payload.nickname,
                            scopes: [],
                        };
                        return;
                    }
                    const key = await options.apiKeysService.findActiveByKey(parsed.token);
                    request.auth = {
                        type: "apiKey",
                        userId: key.userId,
                        apiKeyId: key.id,
                        scopes: key.scopes,
                    };
                    return;
                } catch {
                    // Invalid legacy credentials remain anonymous; protected routes reject them.
                    // A Bearer token that is not a valid legacy JWT is treated as the LLM
                    // provider token (Opción A: `Authorization: Bearer <llm-token>`), exposed
                    // on `request.llmToken` so `POST /tasks` can forward it to Hermes without
                    // prop-drilling through every route handler. In local mode the request
                    // still resolves to the single local user.
                    if (parsed.type === "bearer" && parsed.token.length > 0) {
                        request.llmToken = parsed.token;
                    }
                    try {
                        localUser ??= resolveLocalUser();
                        request.auth = await localUser;
                    } catch {
                        localUser = undefined;
                    }
                    return;
                }
            }

            try {
                localUser ??= resolveLocalUser();
                request.auth = await localUser;
            } catch {
                // Local identity unavailable (e.g. no database in unit tests):
                // stay anonymous. Public routes keep working, protected ones reject.
                localUser = undefined;
            }
        });

        app.decorate("requireAuth", async (request: FastifyRequest) => {
            if (!request.auth) {
                throw AppError.unauthorized();
            }
        });

        app.decorate("requireScope", (...scopes: string[]) => async (request: FastifyRequest) => {
            const auth = getAuthenticatedUser(request);
            if (auth.nickname === env.LOCAL_USER_NICKNAME.trim().toLowerCase()) {
                return;
            }
            if (auth.type === "apiKey") {
                const granted = scopes.some((scope) => auth.scopes.includes(scope));
                if (!granted) {
                    throw AppError.forbidden("Insufficient scope");
                }
            }
        });
    });
}
