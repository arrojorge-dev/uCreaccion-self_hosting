import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { AuthenticatedUser } from "../auth/types.js";
import { DevicesService, type RegisterDeviceResult } from "./index.js";

const VALID_TOKEN = "ab".padEnd(64, "0");

const localUser: AuthenticatedUser = {
    type: "user",
    userId: "user-local",
    nickname: "john",
    scopes: [],
};

class FakeDevicesService extends DevicesService {
    readonly registered: string[] = [];
    readonly unregistered: string[] = [];
    private existing = new Set<string>();

    override async register(input: {
        token: string;
        platform?: string;
    }): Promise<RegisterDeviceResult> {
        this.registered.push(input.token);
        const created = !this.existing.has(input.token);
        this.existing.add(input.token);
        return {
            created,
            device: {
                id: "device-1",
                token: input.token,
                platform: input.platform ?? "ios",
                env: "sandbox",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        };
    }

    override async unregister(token: string): Promise<void> {
        this.unregistered.push(token);
    }
}

describe("rutas /devices", () => {
    let app: FastifyInstance;
    let devices: FakeDevicesService;

    beforeAll(async () => {
        devices = new FakeDevicesService();
        app = buildApp({
            infrastructure: false,
            devicesService: devices,
            resolveLocalUser: async () => localUser,
        });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it("POST /devices crea y devuelve 201", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: VALID_TOKEN, platform: "ios" },
        });
        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({ token: VALID_TOKEN, platform: "ios" });
    });

    it("POST /devices repetido es idempotente y devuelve 200", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: VALID_TOKEN },
        });
        expect(response.statusCode).toBe(200);
        expect(devices.registered).toHaveLength(2);
    });

    it("POST /devices rechaza un token inválido con 400", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: "no-es-hex" },
        });
        expect(response.statusCode).toBe(400);
        expect(devices.registered).toHaveLength(2);
    });

    it("POST /devices rechaza una platform desconocida con 400", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: VALID_TOKEN, platform: "android" },
        });
        expect(response.statusCode).toBe(400);
    });

    it("DELETE /devices/:token devuelve 204", async () => {
        const response = await app.inject({
            method: "DELETE",
            url: `/api/v1/devices/${VALID_TOKEN}`,
        });
        expect(response.statusCode).toBe(204);
        expect(devices.unregistered).toEqual([VALID_TOKEN]);
    });

    it("DELETE /devices/:token inválido devuelve 400", async () => {
        const response = await app.inject({
            method: "DELETE",
            url: "/api/v1/devices/xyz",
        });
        expect(response.statusCode).toBe(400);
    });
});
