import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import {
    APNS_MAX_PAYLOAD_BYTES,
    ApnsPushProvider,
    type ApnsResponse,
    type ApnsTransport,
    buildApnsPayload,
} from "./apns.js";
import type { PushNotification } from "./sender.js";

let keyP8: string;
let publicKey: CryptoKey;

const TEAM_ID = "TEAM123456";
const KEY_ID = "KEY1234567";

beforeAll(async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    keyP8 = await exportPKCS8(pair.privateKey);
    publicKey = pair.publicKey;
});

interface DbState {
    tokens: string[];
    unread: number;
}

function fakeDb(state: DbState): PrismaClient {
    return {
        deviceToken: {
            findMany: async () => state.tokens.map((token) => ({ token })),
            deleteMany: async (args: { where: { token: string } }) => {
                const before = state.tokens.length;
                state.tokens = state.tokens.filter((token) => token !== args.where.token);
                return { count: before - state.tokens.length };
            },
        },
        notification: {
            count: async () => state.unread,
        },
    } as unknown as PrismaClient;
}

class FakeTransport implements ApnsTransport {
    readonly calls: Array<{ token: string; payload: string; jwt: string; collapseId?: string }> =
        [];
    responses: Array<ApnsResponse | Error> = [];
    closed = false;

    async send(
        token: string,
        payload: string,
        jwt: string,
        collapseId?: string,
    ): Promise<ApnsResponse> {
        this.calls.push({ token, payload, jwt, collapseId });
        const next = this.responses.shift();
        if (next === undefined) {
            return { status: 200, body: "" };
        }
        if (next instanceof Error) {
            throw next;
        }
        return next;
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

function taskCompleted(
    status: string,
    overrides: Partial<PushNotification> = {},
): PushNotification {
    return {
        type: "task.completed",
        title: status === "SUCCEEDED" ? "Tarea completada" : "La tarea falló",
        body:
            status === "SUCCEEDED"
                ? "Tu tarea ha terminado correctamente."
                : "Tu tarea no se pudo completar.",
        payload: { taskId: "task-1", status },
        ...overrides,
    };
}

function buildProvider(options: {
    state: DbState;
    transport: FakeTransport;
    now?: () => number;
}): ApnsPushProvider {
    return new ApnsPushProvider({
        db: fakeDb(options.state),
        transport: options.transport,
        apnsEnv: "sandbox",
        keyP8,
        keyId: KEY_ID,
        teamId: TEAM_ID,
        retryDelayMs: 0,
        now: options.now,
    });
}

describe("ApnsPushProvider.send", () => {
    it("ignora notificaciones que no son task.completed", async () => {
        const transport = new FakeTransport();
        const provider = buildProvider({
            state: { tokens: ["aa".padEnd(64, "0")], unread: 1 },
            transport,
        });
        await provider.send("user-1", { type: "other.event", title: "x" });
        expect(transport.calls).toHaveLength(0);
    });

    it("nunca envía push con status CANCELLED", async () => {
        const transport = new FakeTransport();
        const provider = buildProvider({
            state: { tokens: ["aa".padEnd(64, "0")], unread: 1 },
            transport,
        });
        await provider.send("user-1", taskCompleted("CANCELLED"));
        expect(transport.calls).toHaveLength(0);
    });

    it("no envía nada si no hay tokens registrados", async () => {
        const transport = new FakeTransport();
        const provider = buildProvider({ state: { tokens: [], unread: 3 }, transport });
        await provider.send("user-1", taskCompleted("SUCCEEDED"));
        expect(transport.calls).toHaveLength(0);
    });

    it("envía el payload del contrato a todos los tokens con badge = unread", async () => {
        const transport = new FakeTransport();
        const state: DbState = { tokens: ["a".padEnd(64, "0"), "b".padEnd(64, "1")], unread: 7 };
        const provider = buildProvider({ state, transport });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(2);
        expect(transport.calls.map((call) => call.token)).toEqual(state.tokens);
        for (const call of transport.calls) {
            expect(call.collapseId).toBe("task-1");
            const payload = JSON.parse(call.payload) as Record<string, unknown>;
            expect(payload).toMatchObject({
                aps: {
                    alert: {
                        title: "Tarea completada",
                        body: "Tu tarea ha terminado correctamente.",
                    },
                    sound: "default",
                    badge: 7,
                    "content-available": 1,
                },
                taskId: "task-1",
                status: "SUCCEEDED",
            });
            expect(Buffer.byteLength(call.payload, "utf8")).toBeLessThanOrEqual(
                APNS_MAX_PAYLOAD_BYTES,
            );
        }
    });

    it("envía título y body sanitizados en FAILED", async () => {
        const transport = new FakeTransport();
        const provider = buildProvider({
            state: { tokens: ["c".padEnd(64, "2")], unread: 1 },
            transport,
        });

        await provider.send("user-1", taskCompleted("FAILED"));

        const payload = JSON.parse(transport.calls[0]?.payload ?? "{}") as {
            aps: { alert: { title: string; body: string } };
            status: string;
        };
        expect(payload.aps.alert.title).toBe("La tarea falló");
        expect(payload.aps.alert.body).toBe("Tu tarea no se pudo completar.");
        expect(payload.status).toBe("FAILED");
    });

    it("borra el token ante 410 sin reintentar", async () => {
        const transport = new FakeTransport();
        const state: DbState = { tokens: ["d".padEnd(64, "3")], unread: 1 };
        transport.responses = [
            { status: 410, body: JSON.stringify({ reason: "Unregistered", timestamp: 1 }) },
        ];
        const provider = buildProvider({ state, transport });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(1);
        expect(state.tokens).toHaveLength(0);
    });

    it("borra el token ante 400 BadDeviceToken", async () => {
        const transport = new FakeTransport();
        const state: DbState = { tokens: ["e".padEnd(64, "4")], unread: 1 };
        transport.responses = [{ status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) }];
        const provider = buildProvider({ state, transport });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(1);
        expect(state.tokens).toHaveLength(0);
    });

    it("no borra el token ante un 400 con otro reason", async () => {
        const transport = new FakeTransport();
        const state: DbState = { tokens: ["f".padEnd(64, "5")], unread: 1 };
        transport.responses = [
            { status: 400, body: JSON.stringify({ reason: "InvalidProviderToken" }) },
        ];
        const provider = buildProvider({ state, transport });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(1);
        expect(state.tokens).toHaveLength(1);
    });

    it("reintenta una vez ante 500 y tiene éxito", async () => {
        const transport = new FakeTransport();
        transport.responses = [
            { status: 500, body: "" },
            { status: 200, body: "" },
        ];
        const provider = buildProvider({
            state: { tokens: ["a".padEnd(64, "6")], unread: 1 },
            transport,
        });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(2);
    });

    it("reintenta una vez ante 429 y se rinde sin lanzar", async () => {
        const transport = new FakeTransport();
        transport.responses = [
            { status: 429, body: "" },
            { status: 429, body: "" },
        ];
        const provider = buildProvider({
            state: { tokens: ["a".padEnd(64, "7")], unread: 1 },
            transport,
        });

        await expect(provider.send("user-1", taskCompleted("SUCCEEDED"))).resolves.toBeUndefined();
        expect(transport.calls).toHaveLength(2);
    });

    it("reintenta una vez ante un error de red", async () => {
        const transport = new FakeTransport();
        transport.responses = [new Error("socket hang up"), { status: 200, body: "" }];
        const provider = buildProvider({
            state: { tokens: ["a".padEnd(64, "8")], unread: 1 },
            transport,
        });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(2);
    });
});

describe("ApnsPushProvider JWT", () => {
    it("firma un ES256 válido con kid e iss=teamId y lo cachea", async () => {
        const transport = new FakeTransport();
        const provider = buildProvider({
            state: { tokens: ["a".padEnd(64, "9")], unread: 1 },
            transport,
        });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));
        await provider.send("user-1", taskCompleted("FAILED"));

        expect(transport.calls).toHaveLength(2);
        const [first, second] = transport.calls;
        expect(first?.jwt).toBe(second?.jwt);

        const verified = await jwtVerify(first?.jwt ?? "", publicKey);
        expect(verified.protectedHeader.alg).toBe("ES256");
        expect(verified.protectedHeader.kid).toBe(KEY_ID);
        expect(verified.payload.iss).toBe(TEAM_ID);
        expect(typeof verified.payload.iat).toBe("number");
        expect(typeof verified.payload.exp).toBe("number");
        expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(55 * 60);
    });

    it("rota el JWT al superar la ventana de refresco", async () => {
        const transport = new FakeTransport();
        let now = 1_800_000_000_000;
        const provider = buildProvider({
            state: { tokens: ["a".padEnd(64, "9")], unread: 1 },
            transport,
            now: () => now,
        });

        await provider.send("user-1", taskCompleted("SUCCEEDED"));
        now += 51 * 60 * 1000; // > 50 min
        await provider.send("user-1", taskCompleted("SUCCEEDED"));

        expect(transport.calls).toHaveLength(2);
        expect(transport.calls[0]?.jwt).not.toBe(transport.calls[1]?.jwt);
    });
});

describe("buildApnsPayload", () => {
    it("trunca el body para no superar 4096 bytes (multibyte seguro)", () => {
        const payload = buildApnsPayload({
            title: "Tarea completada",
            body: "ñáéíóú😀".repeat(2000),
            badge: 3,
            taskId: "task-1",
            status: "SUCCEEDED",
        });
        expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(APNS_MAX_PAYLOAD_BYTES);
        const parsed = JSON.parse(payload) as { aps: { alert: { title: string; body?: string } } };
        expect(parsed.aps.alert.title).toBe("Tarea completada");
        expect(typeof parsed.aps.alert.body).toBe("string");
    });

    it("omite el body si ni siquiera así cabe", () => {
        const payload = buildApnsPayload({
            title: "Tarea completada",
            badge: 1,
            taskId: "task-1",
            status: "SUCCEEDED",
        });
        const parsed = JSON.parse(payload) as { aps: { alert: { body?: string } } };
        expect(parsed.aps.alert.body).toBeUndefined();
    });
});
