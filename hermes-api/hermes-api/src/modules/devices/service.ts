import { env } from "../../config/env.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { isPrismaError, prisma } from "../../lib/db.js";
import type { DeviceDto } from "./dto.js";

export interface RegisterDeviceInput {
    token: string;
    platform?: string;
}

export interface RegisterDeviceResult {
    device: DeviceDto;
    created: boolean;
}

function toDeviceDto(device: {
    id: string;
    token: string;
    platform: string;
    env: string;
    createdAt: Date;
    updatedAt: Date;
}): DeviceDto {
    return {
        id: device.id,
        token: device.token,
        platform: device.platform,
        env: device.env,
        createdAt: device.createdAt.toISOString(),
        updatedAt: device.updatedAt.toISOString(),
    };
}

export class DevicesService {
    constructor(private readonly db: PrismaClient = prisma) {}

    /**
     * Upsert idempotente por token. Devuelve `created: true` solo si el token no existía.
     * `env` lo fija el servidor (APNS_ENV), nunca el cliente.
     */
    async register(input: RegisterDeviceInput): Promise<RegisterDeviceResult> {
        const token = input.token.toLowerCase();
        const platform = input.platform ?? "ios";
        try {
            const created = await this.db.deviceToken.create({
                data: { token, platform, env: env.APNS_ENV },
            });
            return { device: toDeviceDto(created), created: true };
        } catch (error) {
            if (!isPrismaError(error, "P2002")) {
                throw error;
            }
        }
        const updated = await this.db.deviceToken.update({
            where: { token },
            data: { platform, env: env.APNS_ENV },
        });
        return { device: toDeviceDto(updated), created: false };
    }

    async unregister(token: string): Promise<void> {
        await this.db.deviceToken.deleteMany({ where: { token: token.toLowerCase() } });
    }

    async listTokensForEnv(apnsEnv: string): Promise<string[]> {
        const devices = await this.db.deviceToken.findMany({
            where: { env: apnsEnv },
            select: { token: true },
        });
        return devices.map((device) => device.token);
    }
}
