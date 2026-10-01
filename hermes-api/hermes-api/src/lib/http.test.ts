import { describe, expect, it } from "vitest";
import { startMockServer } from "../../tests/helpers/mock-server.js";
import {
    createHttpClient,
    HttpError,
    MalformedResponseError,
    RequestTimeoutError,
} from "./http.js";

describe("createHttpClient", () => {
    it("GETs JSON and parses it", async () => {
        const server = await startMockServer(() => ({ json: { ok: true } }));
        const client = createHttpClient({ baseUrl: server.url });
        const result = await client.get<{ ok: boolean }>("/v1/ping");
        expect(result).toEqual({ ok: true });
        await client.close();
        await server.close();
    });

    it("sends query params, authorization header and parses request body on POST", async () => {
        let seenUrl = "";
        let seenAuth = "";
        let seenBody = "";
        const server = await startMockServer((req, body) => {
            seenUrl = req.url ?? "";
            seenAuth = req.headers.authorization ?? "";
            seenBody = body;
            return { json: { id: "r1" } };
        });
        const client = createHttpClient({
            baseUrl: server.url,
            headers: { authorization: "Bearer k1" },
        });
        const result = await client.post<{ id: string }>("/v1/echo?stream=false", {
            model: "m",
        });
        expect(result.id).toBe("r1");
        expect(seenUrl).toContain("stream=false");
        expect(seenAuth).toBe("Bearer k1");
        expect(JSON.parse(seenBody)).toEqual({ model: "m" });
        expect(seenBody.length).toBeGreaterThan(0);
        await client.close();
        await server.close();
    });

    it("retries retryable status codes with backoff", async () => {
        let calls = 0;
        const server = await startMockServer(() => {
            calls += 1;
            return calls === 1 ? { status: 503 } : { json: { ok: true } };
        });
        const client = createHttpClient({ baseUrl: server.url, retries: 2 });
        const result = await client.get<{ ok: boolean }>("/v1/ping");
        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
        await client.close();
        await server.close();
    });

    it("throws HttpError for non-retryable status codes", async () => {
        const server = await startMockServer(() => ({ status: 400, text: "bad" }));
        const client = createHttpClient({ baseUrl: server.url });
        await expect(client.get("/v1/ping")).rejects.toMatchObject({
            status: 400,
            bodyText: "bad",
        });
        await client.close();
        await server.close();
    });

    it("throws RequestTimeoutError when the server is too slow", async () => {
        const server = await startMockServer(() => ({ json: { ok: true }, delayMs: 200 }));
        const client = createHttpClient({ baseUrl: server.url, timeoutMs: 50 });
        await expect(client.get("/v1/ping")).rejects.toBeInstanceOf(RequestTimeoutError);
        await client.close();
        await server.close();
    });

    it("throws MalformedResponseError on invalid JSON", async () => {
        const server = await startMockServer(() => ({ text: "not-json" }));
        const client = createHttpClient({ baseUrl: server.url });
        await expect(client.get("/v1/ping")).rejects.toBeInstanceOf(MalformedResponseError);
        await client.close();
        await server.close();
    });
});

describe("HttpError", () => {
    it("reports retryable for 5xx and 429", () => {
        for (const status of [429, 500, 502, 503, 504]) {
            const error = new HttpError({ status, statusText: "", bodyText: "", url: "u" });
            expect(error.retryable).toBe(true);
        }
    });

    it("reports non-retryable for 4xx", () => {
        const error = new HttpError({ status: 404, statusText: "", bodyText: "", url: "u" });
        expect(error.retryable).toBe(false);
    });
});
