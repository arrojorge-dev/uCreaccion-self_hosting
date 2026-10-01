import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { taskEventBus, TaskWorker } from "../../src/modules/tasks/index.js";
import { startMockServer } from "../helpers/mock-server.js";

let app: FastifyInstance;
let worker: TaskWorker;
let mock: Awaited<ReturnType<typeof startMockServer>>;
const createdNicknames: string[] = [];

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

async function registerUser(): Promise<string> {
    const nickname = `failover-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    createdNicknames.push(nickname);
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname, password: "password-123" },
    });
    const body = response.json() as { tokens: { accessToken: string } };
    return body.tokens.accessToken;
}

async function createTask(token: string): Promise<string> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: bearer(token),
        payload: { model: "hermes-agent", input: "x" },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
}

async function waitForStatus(token: string, taskId: string, expected: string): Promise<void> {
    const deadline = Date.now() + 25_000;
    for (;;) {
        const response = await app.inject({
            method: "GET",
            url: `/api/v1/tasks/${taskId}`,
            headers: bearer(token),
        });
        const body = response.json() as { status: string };
        if (body.status === expected) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`task ${taskId} did not reach ${expected} (got ${body.status})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

beforeAll(async () => {
    await prisma.outboxMessage.deleteMany();
    mock = await startMockServer(() => ({
        json: { id: "resp", status: "completed", output_text: "ok" },
    }));
    const client = new HermesClient({ baseUrl: mock.url, apiKey: "test-key", retries: 0 });
    app = buildApp({ infrastructure: false, hermesClient: client });
    worker = new TaskWorker({ client, bus: taskEventBus, pollIntervalMs: 10 });
    await app.ready();
});

afterAll(async () => {
    await worker.stop();
    await app.close();
    await prisma.user.deleteMany({ where: { nickname: { in: createdNicknames } } });
    await prisma.outboxMessage.deleteMany();
    await disconnectDatabase();
    await mock.close();
});

describe("failover", () => {
    it("leaves tasks pending while the worker is down and resumes them on restart", async () => {
        const token = await registerUser();

        const taskId = await createTask(token);

        await new Promise((resolve) => setTimeout(resolve, 300));
        const before = await app.inject({
            method: "GET",
            url: `/api/v1/tasks/${taskId}`,
            headers: bearer(token),
        });
        expect((before.json() as { status: string }).status).toBe("ENQUEUED");

        worker.start();
        await waitForStatus(token, taskId, "SUCCEEDED");
    });

    it("keeps multiple pending tasks queued until the worker is available", async () => {
        await worker.stop();
        const token = await registerUser();
        const first = await createTask(token);
        const second = await createTask(token);

        await new Promise((resolve) => setTimeout(resolve, 300));
        const statuses = await Promise.all(
            [first, second].map(async (id) => {
                const response = await app.inject({
                    method: "GET",
                    url: `/api/v1/tasks/${id}`,
                    headers: bearer(token),
                });
                return (response.json() as { status: string }).status;
            }),
        );
        expect(statuses).toEqual(["ENQUEUED", "ENQUEUED"]);

        worker.start();
        await waitForStatus(token, first, "SUCCEEDED");
        await waitForStatus(token, second, "SUCCEEDED");
    });
});
