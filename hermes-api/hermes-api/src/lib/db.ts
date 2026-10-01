import { PrismaPg } from "@prisma/adapter-pg";
import type { HealthCheck } from "../common/health.js";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 20 });

export const prisma = new PrismaClient({ adapter });

export async function disconnectDatabase(): Promise<void> {
    await prisma.$disconnect();
}

export function databaseHealthCheck(): HealthCheck {
    return {
        name: "database",
        check: async () => {
            await prisma.$queryRaw`SELECT 1`;
        },
    };
}

export function isPrismaError(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === code
    );
}
