import "dotenv/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { taskEventBus, TaskWorker } from "../../src/modules/tasks/index.js";
import { startMockServer } from "../helpers/mock-server.js";

const WORKSPACE = "/tmp/hermes-outputs-test";

interface UserCtx {
    token: string;
    userId: string;
    nickname: string;
}

let app: FastifyInstance;
let worker: TaskWorker;
let mock: Awaited<ReturnType<typeof startMockServer>>;
const createdUsers: Array<{ id: string; nickname: string }> = [];

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

async function registerUser(prefix: string): Promise<UserCtx> {
    const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname, password: "password-123" },
    });
    const body = response.json() as {
        user: { id: string; nickname: string };
        tokens: { accessToken: string };
    };
    createdUsers.push({ id: body.user.id, nickname: body.user.nickname });
    return { token: body.tokens.accessToken, userId: body.user.id, nickname: body.user.nickname };
}

async function createTask(token: string, payload: Record<string, unknown>) {
    return app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: bearer(token),
        payload,
    });
}

async function waitForTask(token: string, taskId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 25_000;
    for (;;) {
        const response = await app.inject({
            method: "GET",
            url: `/api/v1/tasks/${taskId}`,
            headers: bearer(token),
        });
        const body = response.json() as { status: string };
        if (body.status === "SUCCEEDED" || body.status === "FAILED") {
            return response.json() as Record<string, unknown>;
        }
        if (Date.now() > deadline) {
            throw new Error(`task ${taskId} did not reach a final state (got ${body.status})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

beforeAll(async () => {
    await prisma.outboxMessage.deleteMany();
    await prisma.usageRecord.deleteMany();
    await prisma.auditLog.deleteMany();
    await rm(WORKSPACE, { recursive: true, force: true });
    await mkdir(WORKSPACE, { recursive: true });

    mock = await startMockServer(() => ({
        json: { id: "resp", status: "completed", output_text: "ok" },
    }));
    const client = new HermesClient({ baseUrl: mock.url, apiKey: "test-key", retries: 0 });
    app = buildApp({ infrastructure: false, hermesClient: client });
    worker = new TaskWorker({ client, bus: taskEventBus, pollIntervalMs: 10 });
    worker.start();
    await app.ready();
});

afterAll(async () => {
    await worker.stop();
    await app.close();
    await prisma.usageRecord.deleteMany({ where: { userId: { in: createdUsers.map((u) => u.id) } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers.map((u) => u.id) } } });
    await prisma.outboxMessage.deleteMany();
    await rm(WORKSPACE, { recursive: true, force: true });
    await disconnectDatabase();
    await mock.close();
});

describe("output file delivery", () => {
    it("returns the generated file as base64 in resultPayload.files", async () => {
        const user = await registerUser("outfile");
        const content = Buffer.from("%PDF-1.4 fake pdf content");
        await writeFile(`${WORKSPACE}/resultado.pdf`, content);

        const created = await createTask(user.token, {
            model: "hermes-agent",
            input: "genera el pdf",
            outputFile: "resultado.pdf",
        });
        expect(created.statusCode).toBe(201);
        const taskId = (created.json() as { id: string }).id;

        const done = await waitForTask(user.token, taskId);
        expect(done.status).toBe("SUCCEEDED");
        const payload = done.resultPayload as {
            text?: string;
            files?: Array<{ name: string; mimeType: string; size: number; dataBase64: string }>;
        };
        expect(payload.files).toHaveLength(1);
        expect(payload.files?.[0]).toMatchObject({
            name: "resultado.pdf",
            mimeType: "application/pdf",
            size: content.byteLength,
        });
        expect(payload.files?.[0]?.dataBase64).toBe(content.toString("base64"));
        expect(payload.text).toBeUndefined();
    });

    it("fails the task when the requested output file was not generated", async () => {
        const user = await registerUser("outfile-missing");
        const created = await createTask(user.token, {
            model: "hermes-agent",
            input: "genera el pdf",
            outputFile: "inexistente.pdf",
        });
        expect(created.statusCode).toBe(201);
        const taskId = (created.json() as { id: string }).id;

        const done = await waitForTask(user.token, taskId);
        expect(done.status).toBe("FAILED");
        const error = done.error as { code: string; message: string };
        expect(error.code).toBe("OUTPUT_FILE_ERROR");
        expect(error.message).toContain("inexistente.pdf");
    });

    it("rejects path traversal in outputFile", async () => {
        const user = await registerUser("outfile-traversal");
        const response = await createTask(user.token, {
            model: "hermes-agent",
            input: "x",
            outputFile: "../escape.pdf",
        });
        expect(response.statusCode).toBe(400);
    });
});
