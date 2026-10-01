import { AppError } from "../../common/errors/app-error.js";
import { parseDurationSeconds } from "../../common/time.js";
import { env } from "../../config/env.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { randomToken, sha256Hex, verifyPassword } from "../../lib/crypto.js";
import { prisma } from "../../lib/db.js";
import { signAccessToken } from "../../lib/jwt.js";
import { UsersService } from "../users/service.js";
import type { PublicUser } from "../users/types.js";
import type { AuthContext, AuthResult, TokenPair } from "./types.js";

export interface AuthCredentials {
    nickname: string;
    password: string;
}

export interface RegisterInput {
    nickname: string;
    password: string;
    name?: string;
}

export class AuthService {
    constructor(
        private readonly users: UsersService,
        private readonly db: PrismaClient = prisma,
    ) {}

    async register(input: RegisterInput, context: AuthContext): Promise<AuthResult> {
        const user = await this.users.create(input);
        return this.issueTokens(user, context);
    }

    async login(credentials: AuthCredentials, context: AuthContext): Promise<AuthResult> {
        const nickname = credentials.nickname.trim().toLowerCase();
        const user = await this.db.user.findUnique({ where: { nickname } });
        if (!user) {
            throw AppError.unauthorized("Invalid credentials");
        }
        const valid = await verifyPassword(credentials.password, user.passwordHash);
        if (!valid) {
            throw AppError.unauthorized("Invalid credentials");
        }
        return this.issueTokens(UsersService.toPublic(user), context);
    }

    async refresh(rawToken: string, context: AuthContext): Promise<TokenPair> {
        const hash = sha256Hex(rawToken);
        const session = await this.db.authSession.findUnique({
            where: { refreshTokenHash: hash },
            include: { user: true },
        });
        if (!session) {
            throw AppError.unauthorized("Invalid refresh token");
        }
        if (session.revokedAt !== null) {
            await this.revokeFamily(session.id);
            throw AppError.unauthorized("Invalid refresh token");
        }
        if (session.expiresAt.getTime() < Date.now()) {
            await this.db.authSession.update({
                where: { id: session.id },
                data: { revokedAt: new Date() },
            });
            throw AppError.unauthorized("Invalid refresh token");
        }

        const refreshToken = randomToken(48);
        const expiresAt = new Date(Date.now() + parseDurationSeconds(env.JWT_REFRESH_TTL) * 1000);
        const accessToken = await signAccessToken({
            id: session.user.id,
            nickname: session.user.nickname,
        });

        await this.db.$transaction([
            this.db.authSession.create({
                data: {
                    userId: session.userId,
                    refreshTokenHash: sha256Hex(refreshToken),
                    ip: context.ip,
                    userAgent: context.userAgent,
                    rotatedFromId: session.id,
                    expiresAt,
                },
            }),
            this.db.authSession.update({
                where: { id: session.id },
                data: { revokedAt: new Date() },
            }),
        ]);

        return this.tokenPair(accessToken, refreshToken);
    }

    async logout(userId: string, rawToken: string): Promise<void> {
        const session = await this.db.authSession.findUnique({
            where: { refreshTokenHash: sha256Hex(rawToken) },
        });
        if (session && session.userId === userId) {
            await this.db.authSession.update({
                where: { id: session.id },
                data: { revokedAt: new Date() },
            });
        }
    }

    async logoutAll(userId: string): Promise<void> {
        await this.db.authSession.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }

    private async issueTokens(user: PublicUser, context: AuthContext): Promise<AuthResult> {
        const accessToken = await signAccessToken({ id: user.id, nickname: user.nickname });
        const refreshToken = randomToken(48);
        const expiresAt = new Date(Date.now() + parseDurationSeconds(env.JWT_REFRESH_TTL) * 1000);
        await this.db.authSession.create({
            data: {
                userId: user.id,
                refreshTokenHash: sha256Hex(refreshToken),
                ip: context.ip,
                userAgent: context.userAgent,
                expiresAt,
            },
        });
        return { user, tokens: this.tokenPair(accessToken, refreshToken) };
    }

    private tokenPair(accessToken: string, refreshToken: string): TokenPair {
        return {
            accessToken,
            refreshToken,
            expiresIn: parseDurationSeconds(env.JWT_ACCESS_TTL),
            tokenType: "Bearer",
        };
    }

    private async revokeFamily(sessionId: string): Promise<void> {
        const ids = new Set<string>();
        let currentId: string | null = sessionId;
        let guard = 0;
        while (currentId !== null && guard < 100 && !ids.has(currentId)) {
            ids.add(currentId);
            guard += 1;
            const session: { rotatedFromId: string | null } | null =
                await this.db.authSession.findUnique({ where: { id: currentId } });
            currentId = session?.rotatedFromId ?? null;
        }
        const idsArray = [...ids];
        await this.db.authSession.updateMany({
            where: { OR: [{ id: { in: idsArray } }, { rotatedFromId: { in: idsArray } }] },
            data: { revokedAt: new Date() },
        });
    }
}
