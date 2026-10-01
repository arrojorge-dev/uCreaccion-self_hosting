import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer } from "../../../tests/helpers/mock-server.js";
import { buildApp } from "../../app.js";
import { HermesClient } from "./client.js";

const modelList = {
    object: "list",
    data: [{ id: "hermes-agent", object: "model", created: 1786065211, owned_by: "hermes" }],
};

describe("GET /api/v1/hermes/models", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        const server = await startMockServer(() => ({ json: modelList }));
        app = buildApp({
            infrastructure: false,
            hermesClient: new HermesClient({ baseUrl: server.url, apiKey: "test-key" }),
        });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it("returns the model list", async () => {
        const response = await app.inject({ method: "GET", url: "/api/v1/hermes/models" });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.object).toBe("list");
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({ id: "hermes-agent" });
    });

    it("maps upstream failures to a 502 with the canonical error shape", async () => {
        const errorServer = await startMockServer(() => ({ status: 500, text: "boom" }));
        const errorApp = buildApp({
            infrastructure: false,
            hermesClient: new HermesClient({
                baseUrl: errorServer.url,
                apiKey: "test-key",
                retries: 0,
            }),
        });
        await errorApp.ready();
        const response = await errorApp.inject({ method: "GET", url: "/api/v1/hermes/models" });
        expect(response.statusCode).toBe(502);
        const body = response.json();
        expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
        expect(typeof body.error.requestId).toBe("string");
        await errorApp.close();
        await errorServer.close();
    });
});
