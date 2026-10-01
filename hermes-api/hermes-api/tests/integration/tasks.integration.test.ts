import "dotenv/config";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import { taskEventBus } from "../../src/modules/tasks/event-bus.js";
import { TaskWorker } from "../../src/modules/tasks/worker.js";
import { startMockServer, type MockResponse } from "../helpers/mock-server.js";

interface UserCtx {
	token: string;
	nickname: string;
}

let app: FastifyInstance;
let worker: TaskWorker;
let mock: Awaited<ReturnType<typeof startMockServer>>;
let currentHandler: (
	req: IncomingMessage,
	body: string,
) => MockResponse | void | Promise<MockResponse | void>;
const mockCapture: { value: { url: string; body: unknown } | null } = { value: null };

function capturedRequestBody(): unknown {
	return mockCapture.value?.body;
}
const createdNicknames: string[] = [];

function bearer(token: string): { authorization: string } {
	return { authorization: `Bearer ${token}` };
}

function uniqueNickname(prefix: string): string {
	const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
	createdNicknames.push(nickname);
	return nickname;
}

async function registerUser(prefix: string): Promise<UserCtx> {
	const response = await app.inject({
		method: "POST",
		url: "/api/v1/auth/register",
		payload: { nickname: uniqueNickname(prefix), password: "password-123" },
	});
	const body = response.json() as { user: { nickname: string }; tokens: { accessToken: string } };
	return { token: body.tokens.accessToken, nickname: body.user.nickname };
}

async function waitForTaskStatus(
	token: string,
	taskId: string,
	expected: string,
	timeoutMs = 25_000,
): Promise<Record<string, unknown>> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const response = await app.inject({
			method: "GET",
			url: `/api/v1/tasks/${taskId}`,
			headers: bearer(token),
		});
		const body = response.json() as Record<string, unknown>;
		if (body.status === expected) {
			return body;
		}
		if (Date.now() > deadline) {
			throw new Error(`task ${taskId} did not reach ${expected} (got ${String(body.status)})`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

beforeAll(async () => {
	mock = await startMockServer(async (req, body) => {
		mockCapture.value = { url: req.url ?? "", body: body ? JSON.parse(body) : null };
		return currentHandler(req, body);
	});
	const client = new HermesClient({ baseUrl: mock.url, apiKey: "test-key", retries: 0 });
	app = buildApp({ infrastructure: false, hermesClient: client });
	worker = new TaskWorker({ client, bus: taskEventBus, pollIntervalMs: 10 });
	worker.start();
	await app.ready();
	currentHandler = () => ({ json: { id: "resp", status: "completed", output_text: "ok" } });
});

afterAll(async () => {
	await worker.stop();
	await app.close();
	await prisma.user.deleteMany({ where: { nickname: { in: createdNicknames } } });
	await prisma.outboxMessage.deleteMany();
	await disconnectDatabase();
	await mock.close();
});

describe("task lifecycle", () => {
	it("processes a task to completion", async () => {
		currentHandler = () => ({
			json: {
				id: "resp-1",
				status: "completed",
				model: "hermes-agent",
				output_text: "hola",
				usage: { input_tokens: 3, output_tokens: 5 },
			},
		});
		const user = await registerUser("task");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "say hola" },
		});
		expect(created.statusCode).toBe(201);
		const id = (created.json() as { id: string }).id;

		const done = await waitForTaskStatus(user.token, id, "SUCCEEDED");
		expect(done.resultPayload).toMatchObject({ text: "hola" });
		expect(done.attempt).toBe(1);
	});

	it("fails at the first transient failure without retrying", async () => {
		let calls = 0;
		currentHandler = () => {
			calls += 1;
			return { status: 503, text: "overloaded" };
		};
		const user = await registerUser("noretry");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "x", maxAttempts: 3 },
		});
		const done = await waitForTaskStatus(user.token, (created.json() as { id: string }).id, "FAILED");
		// Sin reintento automático: una sola llamada HTTP y un solo attempt.
		expect(calls).toBe(1);
		expect(done.attempt).toBe(1);
		expect((done.error as { code: string }).code).toBeTruthy();
	});

	it("fails at the first error without requeueing (no automatic retry)", async () => {
		currentHandler = () => ({ status: 500, text: "boom" });
		const user = await registerUser("fail");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "x", maxAttempts: 1 },
		});
		const done = await waitForTaskStatus(user.token, (created.json() as { id: string }).id, "FAILED");
		const error = done.error as { code: string; message: string };
		expect(error.code).toBeTruthy();
	});

	it("returns the same task for the same idempotency key", async () => {
		currentHandler = () => ({ json: { id: "resp-3", status: "completed", output_text: "ok" } });
		const user = await registerUser("idem");
		const key = `idem-${Date.now()}`;
		const payload = { model: "hermes-agent", input: "x", idempotencyKey: key };
		const first = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload,
		});
		expect(first.statusCode).toBe(201);
		const firstId = (first.json() as { id: string }).id;
		const second = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload,
		});
		expect(second.statusCode).toBe(200);
		expect((second.json() as { id: string }).id).toBe(firstId);
		await waitForTaskStatus(user.token, firstId, "SUCCEEDED");

		const userRow = await prisma.user.findUnique({ where: { nickname: user.nickname } });
		const count = await prisma.task.count({
			where: { idempotencyKey: key, userId: userRow?.id },
		});
		expect(count).toBe(1);
	});

	it("cancels a running task", async () => {
		currentHandler = () => ({
			json: { id: "resp-4", status: "completed", output_text: "late" },
			delayMs: 5000,
		});
		const user = await registerUser("cancel");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "x" },
		});
		const id = (created.json() as { id: string }).id;
		await waitForTaskStatus(user.token, id, "RUNNING");

		const cancel = await app.inject({
			method: "POST",
			url: `/api/v1/tasks/${id}/cancel`,
			headers: bearer(user.token),
		});
		expect(cancel.statusCode).toBe(204);
		const done = await waitForTaskStatus(user.token, id, "CANCELLED");
		expect(done.cancelledAt).toBeTruthy();
	});

	it("rejects cancelling a finished task", async () => {
		currentHandler = () => ({ json: { id: "resp-5", status: "completed", output_text: "ok" } });
		const user = await registerUser("cancel2");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "x" },
		});
		const id = (created.json() as { id: string }).id;
		await waitForTaskStatus(user.token, id, "SUCCEEDED");
		const cancel = await app.inject({
			method: "POST",
			url: `/api/v1/tasks/${id}/cancel`,
			headers: bearer(user.token),
		});
		expect(cancel.statusCode).toBe(409);
	});
});

describe("streaming", () => {
	it("streams deltas and a final event over SSE", async () => {
		currentHandler = () => ({
			headers: { "content-type": "text/event-stream" },
			text:
				[
					{ type: "response.created", id: "r6" },
					{ type: "response.output_text.delta", delta: "Ho" },
					{ type: "response.output_text.delta", delta: "la" },
					{
						type: "response.completed",
						response: { status: "completed", usage: { input_tokens: 1, output_tokens: 2 } },
					},
				]
					.map((event) => `data: ${JSON.stringify(event)}\n\n`)
					.join("") + "data: [DONE]\n\n",
		});
		const user = await registerUser("stream");
		const response = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "hola", stream: true },
		});
		const body = response.body;
		expect(body).toContain("event: task.queued");
		expect(body).toContain("event: task.output.delta");
		expect(body).toContain('"delta":"Ho"');
		expect(body).toContain('"delta":"la"');
		expect(body).toContain("event: task.succeeded");
	});

	it("replays final state on GET events for a completed task", async () => {
		currentHandler = () => ({ json: { id: "resp-7", status: "completed", output_text: "ok" } });
		const user = await registerUser("events");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "x" },
		});
		const id = (created.json() as { id: string }).id;
		await waitForTaskStatus(user.token, id, "SUCCEEDED");

		const response = await app.inject({
			method: "GET",
			url: `/api/v1/tasks/${id}/events`,
			headers: bearer(user.token),
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toContain("event: task.succeeded");
	});
});

describe("isolation", () => {
	it("never exposes another user's task", async () => {
		currentHandler = () => ({ json: { id: "resp-8", status: "completed", output_text: "ok" } });
		const owner = await registerUser("iso-owner");
		const stranger = await registerUser("iso-stranger");
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(owner.token),
			payload: { model: "hermes-agent", input: "x" },
		});
		await waitForTaskStatus(owner.token, (created.json() as { id: string }).id, "SUCCEEDED");
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/tasks/${(created.json() as { id: string }).id}`,
			headers: bearer(stranger.token),
		});
		expect(res.statusCode).toBe(404);
	});
});

describe("conversations", () => {
	it("appends user and assistant messages to a conversation", async () => {
		currentHandler = () => ({
			json: { id: "resp-9", status: "completed", output_text: "hello back" },
		});
		const user = await registerUser("conv");
		const conversation = await app.inject({
			method: "POST",
			url: "/api/v1/conversations",
			headers: bearer(user.token),
			payload: { title: "Proyecto" },
		});
		expect(conversation.statusCode).toBe(201);
		const conversationId = (conversation.json() as { id: string }).id;

		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "hola amigo", conversationId },
		});
		await waitForTaskStatus(user.token, (created.json() as { id: string }).id, "SUCCEEDED");

		const detail = await app.inject({
			method: "GET",
			url: `/api/v1/conversations/${conversationId}`,
			headers: bearer(user.token),
		});
		expect(detail.statusCode).toBe(200);
		const body = detail.json() as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0]).toMatchObject({ role: "USER", content: "hola amigo" });
		expect(body.messages[1]).toMatchObject({ role: "ASSISTANT", content: "hello back" });
	});

	it("sends the conversation session id to hermes and resets it", async () => {
		currentHandler = () => ({ json: { id: "resp-10", status: "completed", output_text: "ok" } });
		const user = await registerUser("session");
		const conversation = await app.inject({
			method: "POST",
			url: "/api/v1/conversations",
			headers: bearer(user.token),
			payload: { title: "ctx" },
		});
		const conversationId = (conversation.json() as { id: string }).id;
		await prisma.conversation.update({
			where: { id: conversationId },
			data: { hermesSessionId: "hermes-session-1" },
		});

		mockCapture.value = null;
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/tasks",
			headers: bearer(user.token),
			payload: { model: "hermes-agent", input: "x", conversationId },
		});
		await waitForTaskStatus(user.token, (created.json() as { id: string }).id, "SUCCEEDED");

		const requestBody = capturedRequestBody() as { session_id?: string } | undefined;
		expect(requestBody?.session_id).toBe("hermes-session-1");

		const reset = await app.inject({
			method: "POST",
			url: `/api/v1/conversations/${conversationId}/reset`,
			headers: bearer(user.token),
		});
		expect(reset.statusCode).toBe(204);

		const detail = await app.inject({
			method: "GET",
			url: `/api/v1/conversations/${conversationId}`,
			headers: bearer(user.token),
		});
		const body = detail.json() as { conversation: { hermesSessionId: string | null } };
		expect(body.conversation.hermesSessionId).toBeNull();
	});
});
