import { AppError } from "../../common/errors/app-error.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { hashPassword } from "../../lib/crypto.js";
import { isPrismaError, prisma } from "../../lib/db.js";
import type { CreateUserInput, PublicUser, UpdateProfileInput } from "./types.js";

export class UsersService {
    constructor(private readonly db: PrismaClient = prisma) {}

    static toPublic(user: {
        id: string;
        nickname: string;
        name: string | null;
        plan: string;
        createdAt: Date;
    }): PublicUser {
        return {
            id: user.id,
            nickname: user.nickname,
            name: user.name,
            plan: user.plan,
            createdAt: user.createdAt.toISOString(),
        };
    }

    async create(input: CreateUserInput): Promise<PublicUser> {
        const nickname = input.nickname.trim().toLowerCase();
        const passwordHash = await hashPassword(input.password);
        try {
            const user = await this.db.user.create({
                data: {
                    nickname,
                    passwordHash,
                    name: input.name?.trim() || null,
                },
            });
            return UsersService.toPublic(user);
        } catch (error) {
            if (isPrismaError(error, "P2002")) {
                throw AppError.conflict("Nickname is already taken");
            }
            throw error;
        }
    }

    async getById(id: string): Promise<PublicUser> {
        const user = await this.db.user.findUnique({ where: { id } });
        if (!user) {
            throw AppError.notFound("User not found");
        }
        return UsersService.toPublic(user);
    }

    async updateName(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
        const user = await this.db.user.update({
            where: { id: userId },
            data: { name: input.name.trim() },
        });
        return UsersService.toPublic(user);
    }
}
