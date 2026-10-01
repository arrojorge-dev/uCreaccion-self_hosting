import { createServer, type IncomingMessage } from "node:http";

export interface MockResponse {
	status?: number;
	json?: unknown;
	text?: string;
	headers?: Record<string, string>;
	delayMs?: number;
}

export type MockHandler = (
	req: IncomingMessage,
	body: string,
) => MockResponse | void | Promise<MockResponse | void>;

export interface MockServer {
	url: string;
	close: () => Promise<void>;
}

export async function startMockServer(handler: MockHandler): Promise<MockServer> {
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(chunk as Buffer);
		}
		const body = Buffer.concat(chunks).toString();
		let result = (await handler(req, body)) ?? {};

		// El worker llama siempre a /v1/responses con stream:true. Si el test configuró
		// una respuesta JSON, convertirla en un stream SSE equivalente (delta + completed).
		let streamRequest = false;
		try {
			streamRequest = (JSON.parse(body) as { stream?: boolean })?.stream === true;
		} catch {
			streamRequest = false;
		}
		if (streamRequest && result.json !== undefined && result.text === undefined) {
			const json = result.json as Record<string, unknown>;
			const outputText = typeof json.output_text === "string" ? json.output_text : "";
			const events: unknown[] = [
				{ type: "response.created", id: json.id },
				...(outputText
					? [{ type: "response.output_text.delta", delta: outputText }]
					: []),
				{ type: "response.completed", response: json },
			];
			result = {
				...result,
				headers: { ...result.headers, "content-type": "text/event-stream" },
				json: undefined,
				text:
					events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
					"data: [DONE]\n\n",
			};
		}
		if (result.delayMs) {
			await new Promise((resolve) => setTimeout(resolve, result.delayMs));
		}
		if (res.destroyed) {
			return;
		}
		for (const [key, value] of Object.entries(result.headers ?? {})) {
			res.setHeader(key, value);
		}
		res.statusCode = result.status ?? 200;
		if (!result.headers?.["content-type"]) {
			res.setHeader(
				"content-type",
				result.json !== undefined ? "application/json" : "text/plain",
			);
		}
		res.end(result.json !== undefined ? JSON.stringify(result.json) : result.text ?? "");
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	const close = () =>
		new Promise<void>((resolve) => {
			server.close(() => resolve());
		});

	return { url: `http://127.0.0.1:${port}`, close };
}
