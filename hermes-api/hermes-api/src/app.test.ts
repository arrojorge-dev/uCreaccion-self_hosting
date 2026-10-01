import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { AppError } from "./common/errors/app-error.js";

describe("application", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = buildApp({ infrastructure: false });
        app.get("/__test/boom", async () => {
            throw new Error("sensitive-internal-detail");
        });
        app.get("/__test/app-error", async () => {
            throw AppError.notFound("missing resource");
        });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it("serves GET /health/live", async () => {
        const response = await app.inject({ method: "GET", url: "/health/live" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: "ok" });
    });

    it("serves GET /health/ready", async () => {
        const response = await app.inject({ method: "GET", url: "/health/ready" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: "ok", checks: [] });
    });

    it("sets x-request-id on responses", async () => {
        const response = await app.inject({ method: "GET", url: "/health/live" });
        expect(response.headers["x-request-id"]).toBeTruthy();
    });

    it("returns a consistent 404 shape", async () => {
        const response = await app.inject({ method: "GET", url: "/does-not-exist" });
        expect(response.statusCode).toBe(404);
        const body = response.json();
        expect(body.error.code).toBe("NOT_FOUND");
        expect(typeof body.error.requestId).toBe("string");
    });

    it("does not leak internal error details", async () => {
        const response = await app.inject({ method: "GET", url: "/__test/boom" });
        expect(response.statusCode).toBe(500);
        const body = response.json();
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(body.error.message).toBe("Internal server error");
        expect(JSON.stringify(body)).not.toContain("sensitive-internal-detail");
    });

    it("maps AppError to its status code", async () => {
        const response = await app.inject({ method: "GET", url: "/__test/app-error" });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe("NOT_FOUND");
        expect(response.json().error.message).toBe("missing resource");
    });
});
