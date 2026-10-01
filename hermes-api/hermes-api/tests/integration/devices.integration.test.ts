import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";

const VALID_TOKEN = "cd".padEnd(64, "e");

let app: FastifyInstance;

beforeAll(async () => {
    await prisma.deviceToken.deleteMany();
    app = buildApp({ infrastructure: false });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await prisma.deviceToken.deleteMany();
    await disconnectDatabase();
});

describe("POST /api/v1/devices (sin credenciales: modo local)", () => {
    it("registra un token nuevo con 201", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: VALID_TOKEN, platform: "ios" },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json() as { token: string; platform: string; env: string };
        expect(body.token).toBe(VALID_TOKEN);
        expect(body.platform).toBe("ios");
        // APNS_ENV no está fijado en el entorno de integración → default "sandbox".
        expect(body.env).toBe("sandbox");
    });

    it("re-registrar el mismo token es idempotente y devuelve 200", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: VALID_TOKEN },
        });
        expect(response.statusCode).toBe(200);
        const count = await prisma.deviceToken.count({ where: { token: VALID_TOKEN } });
        expect(count).toBe(1);
    });

    it("normaliza el token a minúsculas", async () => {
        const upper = VALID_TOKEN.toUpperCase();
        const response = await app.inject({
            method: "POST",
            url: "/api/v1/devices",
            payload: { token: upper },
        });
        expect(response.statusCode).toBe(200);
        // El token en mayúsculas no crea una fila nueva: se normaliza a la existente.
        expect(await prisma.deviceToken.count({ where: { token: upper } })).toBe(0);
        expect(await prisma.deviceToken.count({ where: { token: VALID_TOKEN } })).toBe(1);
    });

    it("rechaza tokens inválidos con 400", async () => {
        for (const token of ["corto", "zz".padEnd(64, "z"), `${VALID_TOKEN}ff`]) {
            const response = await app.inject({
                method: "POST",
                url: "/api/v1/devices",
                payload: { token },
            });
            expect(response.statusCode).toBe(400);
        }
    });
});

describe("DELETE /api/v1/devices/:token", () => {
    it("borra un token existente con 204", async () => {
        const response = await app.inject({
            method: "DELETE",
            url: `/api/v1/devices/${VALID_TOKEN}`,
        });
        expect(response.statusCode).toBe(204);
        const count = await prisma.deviceToken.count({ where: { token: VALID_TOKEN } });
        expect(count).toBe(0);
    });

    it("borrar un token inexistente sigue devolviendo 204 (idempotente)", async () => {
        const response = await app.inject({
            method: "DELETE",
            url: `/api/v1/devices/${VALID_TOKEN}`,
        });
        expect(response.statusCode).toBe(204);
    });
});
