import { describe, expect, it } from "vitest";
import { startMockServer } from "../../../tests/helpers/mock-server.js";
import { HermesClient } from "./client.js";
import { HermesService } from "./service.js";

const modelList = {
    object: "list",
    data: [{ id: "hermes-agent", object: "model", created: 1786065211, owned_by: "hermes" }],
};

describe("HermesClient", () => {
    it("authenticates with a bearer token on every request", async () => {
        let seenAuth = "";
        const server = await startMockServer((req) => {
            seenAuth = req.headers.authorization ?? "";
            return { json: modelList };
        });
        const client = new HermesClient({ baseUrl: server.url, apiKey: "secret-key" });
        const models = await client.models();
        expect(models).toHaveLength(1);
        expect(seenAuth).toBe("Bearer secret-key");
        await client.close();
        await server.close();
    });

    it("fetches models", async () => {
        const server = await startMockServer(() => ({ json: modelList }));
        const client = new HermesClient({ baseUrl: server.url, apiKey: "k" });
        const models = await client.models();
        expect(models[0]?.id).toBe("hermes-agent");
        await client.close();
        await server.close();
    });

    it("creates a response with the given params", async () => {
        let seenBody = "";
        const server = await startMockServer((_req, body) => {
            seenBody = body;
            return { json: { id: "resp-1", object: "response", status: "completed", model: "m" } };
        });
        const client = new HermesClient({ baseUrl: server.url, apiKey: "k" });
        const result = await client.responsesCreate({
            model: "hermes-agent",
            input: "hello",
            stream: false,
        });
        expect(result.id).toBe("resp-1");
        expect(JSON.parse(seenBody)).toMatchObject({
            model: "hermes-agent",
            input: "hello",
            stream: false,
        });
        await client.close();
        await server.close();
    });

    it("streams SSE events and ignores [DONE]", async () => {
        const events = [
            { type: "response.created", id: "r1" },
            { type: "response.output_text.delta", text: "hola" },
        ];
        const server = await startMockServer(() => ({
            headers: { "content-type": "text/event-stream" },
            text:
                events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
                "data: [DONE]\n\n",
        }));
        const client = new HermesClient({ baseUrl: server.url, apiKey: "k" });
        const collected: { type?: string }[] = [];
        for await (const event of client.streamResponses({ model: "m", input: "x" })) {
            collected.push(event);
        }
        expect(collected).toHaveLength(2);
        expect(collected[1]).toMatchObject({ type: "response.output_text.delta", text: "hola" });
        await client.close();
        await server.close();
    });
});

describe("HermesService error mapping", () => {
    it("maps a 500 upstream response to UPSTREAM_UNAVAILABLE (502)", async () => {
        const server = await startMockServer(() => ({ status: 500, text: "boom" }));
        const service = new HermesService(
            new HermesClient({ baseUrl: server.url, apiKey: "k", retries: 0 }),
        );
        await expect(service.createResponse({ model: "m", input: "x" })).rejects.toMatchObject({
            code: "UPSTREAM_UNAVAILABLE",
            statusCode: 502,
            retryable: true,
        });
        await server.close();
    });

    it("maps a timeout to UPSTREAM_TIMEOUT (502)", async () => {
        const server = await startMockServer(() => ({ json: {}, delayMs: 200 }));
        const service = new HermesService(
            new HermesClient({ baseUrl: server.url, apiKey: "k", timeoutMs: 50, retries: 0 }),
        );
        await expect(service.createResponse({ model: "m", input: "x" })).rejects.toMatchObject({
            code: "UPSTREAM_TIMEOUT",
            statusCode: 502,
            retryable: true,
        });
        await server.close();
    });

    it("maps a 400 upstream rejection to UPSTREAM_ERROR (502)", async () => {
        const server = await startMockServer(() => ({ status: 400, text: "bad request" }));
        const service = new HermesService(
            new HermesClient({ baseUrl: server.url, apiKey: "k", retries: 0 }),
        );
        await expect(
            service.chatCompletion({ model: "m", messages: [{ role: "user", content: "x" }] }),
        ).rejects.toMatchObject({
            code: "UPSTREAM_ERROR",
            statusCode: 502,
        });
        await server.close();
    });
});
